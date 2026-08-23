import type { Subprocess } from "bun";
import { createHash } from "node:crypto";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import type {
  ExecRequest,
  ExecutionResult,
  OutputChunk,
  SandboxProvider,
} from "../sandboxes";
import { allocateHostPort, commandFailure, publishedPort } from "../sandboxes";

type RunCommand = (
  command: readonly string[],
  onOutput?: (chunk: OutputChunk) => void,
) => Promise<ExecutionResult>;

const LOG_TAIL = 32_000;
/** Long enough to span the gap between runs in a working session. */
const GOLDEN_IDLE_TTL_MS = 15 * 60_000;
const localImageDir = join(tmpdir(), "colony-smolvm-images");

function tailLog(text: string): string {
  return text.length <= LOG_TAIL ? text : text.slice(-LOG_TAIL);
}

/** True when the forwarded Preview URL answers HTTP, not merely TCP. */
export async function probePreviewUrl(
  url: string,
  timeoutMs = 750,
): Promise<boolean> {
  try {
    new URL(url);
  } catch {
    return false;
  }
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

function isLocalImageSource(image: string): boolean {
  return (
    image === "-" ||
    isAbsolute(image) ||
    image.startsWith("./") ||
    image.startsWith("../") ||
    /\.tar(\.gz)?$/.test(image) ||
    image.endsWith(".tgz")
  );
}

/** Short names like `sweat-agent-cursor:latest` are Docker Hub library refs to crane. */
function hasRegistryHost(image: string): boolean {
  const name = image.split("@")[0] ?? image;
  const lastSlash = name.lastIndexOf("/");
  const lastColon = name.lastIndexOf(":");
  const untagged = lastColon > lastSlash ? name.slice(0, lastColon) : name;
  const host = untagged.split("/")[0] ?? "";
  return host.includes(".") || host.includes(":") || host === "localhost";
}

/** Captures a host command's output, streaming it as it arrives when asked. */
async function runCommand(
  command: readonly string[],
  onOutput?: (chunk: OutputChunk) => void,
): Promise<ExecutionResult> {
  let child: Subprocess<"ignore", "pipe", "pipe">;
  try {
    child = Bun.spawn([...command], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return { exitCode: 127, stdout: "", stderr: `${command[0]} is not available` };
  }
  const read = async (
    stream: ReadableStream<Uint8Array>,
    name: "stdout" | "stderr",
  ): Promise<string> => {
    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of stream) {
      const part = decoder.decode(chunk, { stream: true });
      text += part;
      onOutput?.({ stream: name, text: part });
    }
    return text;
  };
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    read(child.stdout, "stdout"),
    read(child.stderr, "stderr"),
  ]);
  return { exitCode, stdout, stderr };
}

function imageId(stdout: string): string | undefined {
  const line = stdout.trim().split(/\s+/)[0];
  if (!line) return undefined;
  return line.replace(/^sha256:/, "").slice(0, 64);
}

/**
 * smolvm treats a bare tag as a registry pull, so export local Docker images.
 */
export async function resolveSmolvmImage(
  image: string,
  run: RunCommand = runCommand,
): Promise<string> {
  if (isLocalImageSource(image)) return image;

  const inspected = await run([
    "docker",
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    image,
  ]);
  if (inspected.exitCode === 0) {
    const id = imageId(inspected.stdout);
    if (id) {
      await mkdir(localImageDir, { recursive: true });
      const tar = join(localImageDir, `${id}.tar`);
      if ((await Bun.file(tar).size) > 0) return tar;
      const saved = await run(["docker", "save", "-o", tar, image]);
      if (saved.exitCode !== 0) {
        throw new Error(
          `Could not export sandbox image ${image}: ${saved.stderr.trim() || saved.stdout.trim()}`,
        );
      }
      if ((await Bun.file(tar).size) === 0) {
        throw new Error(`Could not export sandbox image ${image}: empty archive`);
      }
      return tar;
    }
  }

  const appleImage = await run(["container", "image", "inspect", image]);
  if (appleImage.exitCode === 0) {
    throw new Error(
      `Sandbox image ${image} is an Apple Container image, whose OCI archive smolvm cannot import. Set SWEAT_CONTAINER_PROVIDER=docker and run make agent.`,
    );
  }

  if (hasRegistryHost(image)) return image;
  throw new Error(
    `Sandbox image ${image} is not a local Docker image. smolvm will not pull short names from Docker Hub. Run make agent.`,
  );
}

/**
 * Guest dockerd on the VM ext4 disk. Does not expose the socket to the host.
 * Runs once on the golden, so every clone inherits a daemon that is already up:
 * a Preview command may run Compose, and nobody pays the readiness poll.
 */
const guestDockerInit = [
  // bun's default hardlink/clonefile backends hang on the /work bind mount.
  "if command -v bun >/dev/null 2>&1; then",
  "  mkdir -p /storage/bun",
  "  printf '%s\\n' '[install]' 'backend = \"copyfile\"' 'cache = \"/storage/bun\"' > /root/.bunfig.toml",
  "fi",
  "echo 'precedence :ffff:0:0/96  100' >> /etc/gai.conf",
  "command -v dockerd >/dev/null 2>&1 || exit 0",
  "mkdir -p /storage/docker /var/lib/docker",
  "mount --bind /storage/docker /var/lib/docker || true",
  // Debian docker-ce defaults to systemd; smolvm has no systemd as PID 1.
  "if [ -f /sys/fs/cgroup/cgroup.controllers ]; then",
  "  mkdir -p /sys/fs/cgroup/init",
  "  xargs -rn1 </sys/fs/cgroup/cgroup.procs >/sys/fs/cgroup/init/cgroup.procs 2>/dev/null || true",
  "  sed -e 's/ / +/g' -e 's/^/+/' </sys/fs/cgroup/cgroup.controllers >/sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || true",
  "fi",
  "rm -f /var/run/docker.pid",
  "nohup dockerd --data-root=/storage/docker --storage-driver=overlay2 --exec-opt native.cgroupdriver=cgroupfs >/tmp/dockerd.log 2>&1 &",
  'i=0; while [ "$i" -lt 30 ]; do docker info >/dev/null 2>&1 && exit 0; i=$((i + 1)); sleep 1; done',
  'echo "dockerd did not become ready" >> /tmp/dockerd.log',
  "exit 0",
].join("\n");

export type SmolMachine = {
  exec(
    command: readonly string[],
    options?: {
      env?: Record<string, string>;
      workdir?: string;
      onOutput?: (chunk: OutputChunk) => void;
    },
  ): Promise<ExecutionResult>;
  delete(): Promise<void>;
};

export type MachineConfig = {
  name: string;
  image: string;
  network: boolean;
  mounts?: ReadonlyArray<{ source: string; target: string; readOnly: boolean }>;
  ports?: ReadonlyArray<{ host: number; guest: number }>;
  /** Start as a fork base: memfd-backed guest RAM plus a control socket. */
  forkable?: boolean;
  mem?: number;
  cpus?: number;
  /** Resolver for the guest, whose default is the public 8.8.8.8 and 1.1.1.1. */
  dns?: string;
  /** Host directory holding only the extra CA bundle, mounted read-only. */
  caDirectory?: string;
};

/**
 * A guest mount is a directory: virtiofs cannot pass a single file, and mounting
 * the bundle's own directory would expose whatever else lives beside it — a
 * private key, usually. So the provider stages the bundle alone under a fixed
 * name, and this is where a guest reads it.
 */
const guestCaDirectory = "/etc/ssl/colony-ca";
export const guestExtraCaCertificate = `${guestCaDirectory}/sweat-extra-ca.pem`;
/** Not /etc/ssl/certs: mounting over that directory hides every system CA. */
const caStageDir = join(tmpdir(), "colony-smolvm-ca");

/** Where a golden mounts the directory holding every run's workspace. */
export const guestWorkspacesRoot = "/mnt/ws";

/** Goldens are named, not labelled: `machine fork` takes no `--label`. */
const goldenPrefix = "colony-golden-";

export function goldenMachineName(image: string, workspacesRoot: string): string {
  const key = createHash("sha256")
    .update(`${image}\0${workspacesRoot}`)
    .digest("hex")
    .slice(0, 12);
  return `${goldenPrefix}${key}`;
}

export function isGoldenMachine(name: string): boolean {
  return name.startsWith(goldenPrefix);
}

/**
 * A clone inherits the golden's one mount — `machine fork` takes no `-v` — so
 * every clone can see every run's workspace through it. Bind this clone's own
 * directory onto the target the caller asked for, then cover the shared root
 * with an empty tmpfs so the siblings are unreachable from inside the guest.
 * Mounts are per-VM kernel state, so this is private to the clone.
 *
 * ponytail: guest-side, so root in the guest could unmount it. Host-enforced
 * isolation needs a per-clone mount, which `fork` cannot do; revisit if smolvm
 * gains `fork -v`.
 */
export function guestMountIsolation(
  mounts: ReadonlyArray<{ source: string; target: string }>,
): string {
  return [
    ...mounts.flatMap((mount) => [
      `mkdir -p ${mount.target}`,
      `mount -o bind ${guestWorkspacesRoot}/${basename(mount.source)} ${mount.target}`,
    ]),
    `mount -t tmpfs none ${guestWorkspacesRoot}`,
  ].join("\n");
}

/** The fields Colony reads off a `smolvm machine ls --json` row. */
type MachineListEntry = { name: string } & Partial<{
  state: string;
  image: string;
  created_at: number;
  mounts: number;
  network: boolean;
}>;

/** Newest first, then by name: the CLI's own order reshuffles between polls. */
function parseMachineList(stdout: string): MachineListEntry[] {
  try {
    const rows: unknown = JSON.parse(stdout);
    if (!Array.isArray(rows)) return [];
    return (rows as MachineListEntry[])
      .filter((row) => typeof row?.name === "string")
      .sort(
        (left, right) =>
          (right.created_at ?? 0) - (left.created_at ?? 0) ||
          left.name.localeCompare(right.name),
      );
  } catch {
    return [];
  }
}

export type SmolvmMachineStatus = {
  id: string;
  state: string;
  image: string;
  createdAt: number;
  mounts: number;
  network: boolean;
  previewUrl?: string;
  previewReady?: boolean;
  previewError?: string;
  /** A fork base rather than a sandbox: shared by every run of one image. */
  golden?: boolean;
};

export type MachineLogChannelName = NonNullable<ExecRequest["log"]> | "docker";

export type MachineLogChannel = {
  name: MachineLogChannelName;
  text: string;
};

export type SmolvmMachineLogs = {
  channels: MachineLogChannel[];
};

export type SmolvmMachineControl = {
  listMachines(): Promise<SmolvmMachineStatus[]>;
  nukeMachine(id: string): Promise<boolean>;
  machineLogs(id: string): Promise<SmolvmMachineLogs | undefined>;
  execMachine(id: string, command: string): Promise<ExecutionResult | undefined>;
};

/**
 * Fork bases outlive the runs that used them, so the process that booted them
 * has to reap them. Separate from the console's surface, which never needs it.
 */
export type SmolvmGoldens = {
  disposeGoldens(): Promise<void>;
};

/** A fork base and the clones still using it. */
type GoldenEntry = {
  machine: Promise<SmolMachine>;
  clones: Set<string>;
  /** Pending reap, armed once the last clone goes and cleared when one returns. */
  idle?: ReturnType<typeof setTimeout>;
};

/** The per-machine facts `smolvm machine ls` cannot report. */
type ManagedMachine = {
  machine: SmolMachine;
  dispose(): Promise<void>;
  /** The Colony tag, which the CLI only knows as a `local:<digest>` archive. */
  image: string;
  previewUrl?: string;
  previewError?: string;
  logs: { init?: string; preview?: string };
};

/** The machine settings smolvm takes as `machine create` flags. */
export function smolvmCreateFlags(config: MachineConfig): string[] {
  return [
    ...(config.mem === undefined ? [] : ["--mem", String(config.mem)]),
    ...(config.cpus === undefined ? [] : ["--cpus", String(config.cpus)]),
    // Always virtio-net: publishing a Preview port makes smolvm pick that
    // backend, and a guest booted on the default TSI has no interface for it —
    // a clone forked with `-p` off a TSI golden loses the network entirely.
    ...(config.network ? ["--net", "--net-backend", "virtio-net"] : []),
    ...(config.dns ? ["--dns", config.dns] : []),
    ...(config.caDirectory
      ? ["-v", `${config.caDirectory}:${guestCaDirectory}:ro`]
      : []),
    ...(config.mounts ?? []).flatMap((mount) => [
      "-v",
      `${mount.source}:${mount.target}${mount.readOnly ? ":ro" : ""}`,
    ]),
    ...(config.ports ?? []).flatMap((port) => [
      "-p",
      `${port.host}:${port.guest}`,
    ]),
  ];
}

/**
 * Default IPv4 gateway from a Linux `/proc/net/route` table. Little-endian
 * hex, same layout the kernel writes; virtio-net and TSI both publish one.
 */
export function parseDefaultGateway(table: string): string | undefined {
  for (const line of table.split(/\r?\n/).slice(1)) {
    const columns = line.trim().split(/\s+/);
    const destination = columns[1];
    const gateway = columns[2];
    if (destination !== "00000000" || !gateway || gateway === "00000000") {
      continue;
    }
    const value = Number.parseInt(gateway, 16);
    if (!Number.isFinite(value)) continue;
    return [
      value & 255,
      (value >> 8) & 255,
      (value >> 16) & 255,
      (value >> 24) & 255,
    ].join(".");
  }
  return undefined;
}

/**
 * Every machine boots on virtio-net, so a guest has a default route to the
 * host. The localhost fallback covers one that came up without a route: on
 * libkrun's TSI backend a guest's loopback is redirected to the host's own, so
 * `127.0.0.1` still answers there — which is not "unknown".
 */
async function guestDefaultGateway(
  machine: SmolMachine,
): Promise<string | undefined> {
  try {
    const result = await machine.exec(["cat", "/proc/net/route"]);
    if (result.exitCode !== 0) return undefined;
    return parseDefaultGateway(result.stdout) ?? "127.0.0.1";
  } catch {
    return undefined;
  }
}

/**
 * The SDK parses local archives as registry references and waits for Preview
 * ports before their workload starts, so Colony drives smolvm through its CLI.
 */
function leftoverVmDataDir(text: string): string | undefined {
  const match = text.match(
    /delete machine data: (\/[^\n:]+): Directory not empty/,
  );
  const dir = match?.[1];
  if (!dir?.includes("/smolvm/vms/") || dir.includes("..")) return undefined;
  return dir;
}

function smolvmAlreadyGone(text: string): boolean {
  return /vm not found|no such machine/i.test(text);
}

/** Resolves false when the machine was already gone, true when this call removed it. */
async function deleteSmolvmMachine(
  name: string,
  run: RunCommand,
): Promise<boolean> {
  const args = ["smolvm", "machine", "delete", "--name", name, "-f"] as const;
  const fail = (result: ExecutionResult): never => {
    throw new Error(commandFailure(`smolvm ${args.slice(1).join(" ")}`, result));
  };
  const result = await run(args);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode === 0) return true;
  if (smolvmAlreadyGone(output)) return false;
  const leftover = leftoverVmDataDir(output);
  if (!leftover) return fail(result);
  await rm(leftover, { recursive: true, force: true });
  const retry = await run(args);
  if (retry.exitCode === 0) return true;
  if (smolvmAlreadyGone(`${retry.stdout}\n${retry.stderr}`)) return false;
  return fail(retry);
}

export async function createSmolvmMachine(
  config: MachineConfig,
  run: RunCommand = runCommand,
): Promise<SmolMachine> {
  const smolvm = async (...args: string[]): Promise<ExecutionResult> => {
    const result = await run(["smolvm", ...args]);
    if (result.exitCode !== 0) {
      throw new Error(commandFailure(`smolvm ${args.join(" ")}`, result));
    }
    return result;
  };
  const { name } = config;

  await smolvm(
    "machine",
    "create",
    "--name",
    name,
    "--image",
    config.image,
    ...smolvmCreateFlags(config),
  );
  try {
    await smolvm(
      "machine",
      "start",
      "--name",
      name,
      ...(config.forkable ? ["--forkable"] : []),
    );
  } catch (error) {
    await deleteSmolvmMachine(name, run).catch(() => undefined);
    throw error;
  }

  return smolvmMachineHandle(name, run);
}

/** `exec` and `delete` against a named machine, however that machine was made. */
function smolvmMachineHandle(name: string, run: RunCommand): SmolMachine {
  return {
    exec(command, options = {}) {
      return run(
        [
          "smolvm",
          "machine",
          "exec",
          "--stream",
          "--name",
          name,
          ...(options.workdir ? ["--workdir", options.workdir] : []),
          ...Object.entries(options.env ?? {}).flatMap(([key, value]) => [
            "--env",
            `${key}=${value}`,
          ]),
          "--",
          ...command,
        ],
        options.onOutput,
      );
    },
    async delete() {
      await deleteSmolvmMachine(name, run);
    },
  };
}

/**
 * Copy-on-write clone of a running forkable golden: live RAM and disks, so the
 * clone starts with the golden's dockerd already up. Ports must be pinned here
 * or smolvm remaps the golden's forwards, and the golden publishes none.
 */
export async function forkSmolvmMachine(
  golden: string,
  name: string,
  ports: ReadonlyArray<{ host: number; guest: number }> = [],
  run: RunCommand = runCommand,
): Promise<SmolMachine> {
  const args = [
    "machine",
    "fork",
    "--golden",
    golden,
    "--name",
    name,
    ...ports.flatMap((port) => ["-p", `${port.host}:${port.guest}`]),
  ];
  const result = await run(["smolvm", ...args]);
  if (result.exitCode !== 0) {
    throw new Error(commandFailure(`smolvm ${args.join(" ")}`, result));
  }
  return smolvmMachineHandle(name, run);
}

function envVars(
  env?: Record<string, string | undefined>,
): Record<string, string> | undefined {
  if (!env) return undefined;
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function mount(volume: string) {
  const colon = volume.lastIndexOf(":");
  return {
    source: volume.slice(0, colon),
    target: volume.slice(colon + 1),
    readOnly: false,
  };
}

export function createSmolvmSandboxProvider(
  options: {
    createMachine?: (config: MachineConfig) => Promise<SmolMachine>;
    createId?: () => string;
    allocatePort?: () => Promise<number>;
    resolveImage?: (image: string) => Promise<string>;
    probePreview?: (url: string) => Promise<boolean>;
    forkMachine?: (
      golden: string,
      name: string,
      ports: ReadonlyArray<{ host: number; guest: number }>,
    ) => Promise<SmolMachine>;
    /** How long a golden with no clones is kept before its RAM is released. */
    goldenIdleTtlMs?: number;
    /**
     * A guest resolves through public DNS, so an internal model or MCP endpoint
     * is NXDOMAIN unless the operator names a resolver that knows their zone.
     *
     * ponytail: one IP, because `smolvm --dns` rejects a second. A host whose
     * resolvers fail over needs smolvm to accept a list first.
     */
    dns?: string;
    /** Host path of a private CA the guest must trust to reach such a host. */
    caCertificate?: string;
    /** Guest RAM in MiB and vCPU count for every machine this provider boots. */
    mem?: number;
    cpus?: number;
    run?: RunCommand;
  } = {},
): SandboxProvider & SmolvmMachineControl & SmolvmGoldens {
  if (options.caCertificate && !isAbsolute(options.caCertificate)) {
    throw new Error("smolvm agent CA certificate path must be absolute");
  }
  /** Copied once: a golden and a fallback boot both mount the same staging. */
  let staging: Promise<string> | undefined;
  const stageCaCertificate = (path: string): Promise<string> =>
    (staging ??= (async () => {
      await mkdir(caStageDir, { recursive: true });
      await copyFile(path, join(caStageDir, basename(guestExtraCaCertificate)));
      return caStageDir;
    })());

  /**
   * Every machine this provider boots, golden or fallback, needs all four. A
   * clone takes its size from the golden it forks, so setting it here covers
   * the clones too — `machine fork` has no size flags of its own.
   */
  const hostAccess = async (): Promise<Partial<MachineConfig>> => ({
    ...(options.dns ? { dns: options.dns } : {}),
    ...(options.caCertificate
      ? { caDirectory: await stageCaCertificate(options.caCertificate) }
      : {}),
    ...(options.mem === undefined ? {} : { mem: options.mem }),
    ...(options.cpus === undefined ? {} : { cpus: options.cpus }),
  });
  const createMachine = options.createMachine ?? createSmolvmMachine;
  const createId = options.createId ?? (() => `sandbox-${crypto.randomUUID()}`);
  const allocatePort = options.allocatePort ?? allocateHostPort;
  const resolveImage = options.resolveImage ?? resolveSmolvmImage;
  const probePreview = options.probePreview ?? probePreviewUrl;
  const run = options.run ?? runCommand;
  const forkMachine =
    options.forkMachine ??
    ((golden, name, ports) => forkSmolvmMachine(golden, name, ports, run));
  const goldenIdleTtlMs = options.goldenIdleTtlMs ?? GOLDEN_IDLE_TTL_MS;
  const machines = new Map<string, ManagedMachine>();
  /** One golden per resolved image and workspaces root — the two things its
   *  mounts depend on. Memoised as a Promise so concurrent runs share one boot. */
  const goldens = new Map<string, GoldenEntry>();

  /** Deletes a golden that no clone is using, releasing the RAM it holds. */
  const reapGolden = async (name: string): Promise<void> => {
    const entry = goldens.get(name);
    if (!entry || entry.clones.size > 0) return;
    goldens.delete(name);
    await deleteSmolvmMachine(name, run).catch(() => undefined);
  };

  /**
   * A frozen golden does no work but still holds its guest RAM — measured at
   * ~2.8GiB against ~70MiB for each clone that shares it. So it is worth
   * keeping while runs keep arriving, and worth dropping once they stop.
   */
  const releaseGolden = (name: string, cloneId: string): void => {
    const entry = goldens.get(name);
    if (!entry) return;
    entry.clones.delete(cloneId);
    if (entry.clones.size > 0) return;
    entry.idle = setTimeout(() => void reapGolden(name), goldenIdleTtlMs);
    entry.idle.unref?.();
  };

  const golden = (
    image: string,
    workspacesRoot: string,
  ): Promise<SmolMachine> => {
    const name = goldenMachineName(image, workspacesRoot);
    const existing = goldens.get(name);
    if (existing) {
      if (existing.idle) clearTimeout(existing.idle);
      delete existing.idle;
      return existing.machine;
    }
    const booting = (async () => {
      // A golden from a previous coordinator is frozen and cannot be forked again.
      await deleteSmolvmMachine(name, run).catch(() => undefined);
      const machine = await createMachine({
        name,
        image,
        network: true,
        forkable: true,
        ...(await hostAccess()),
        ...(workspacesRoot
          ? {
              mounts: [
                {
                  source: workspacesRoot,
                  target: guestWorkspacesRoot,
                  readOnly: false,
                },
              ],
            }
          : {}),
      });
      await machine.exec(["sh", "-c", guestDockerInit]);
      return machine;
    })().catch((error: unknown) => {
      goldens.delete(name);
      throw error;
    });
    goldens.set(name, { machine: booting, clones: new Set() });
    return booting;
  };

  /**
   * A clone of this image's golden, or — when anything about forking fails — a
   * machine booted the old way so a run never dies for want of a fork.
   *
   * ponytail: the fallback re-boots per sandbox and loses the speed win. It
   * exists because forking is a host capability the operator did not opt into;
   * drop it once smolvm forking is a stated requirement of `make setup`.
   */
  const forkFromGolden = async (sandbox: {
    id: string;
    image: string;
    mounts?: ReadonlyArray<{ source: string; target: string; readOnly: boolean }>;
    ports: ReadonlyArray<{ host: number; guest: number }>;
  }): Promise<{ machine: SmolMachine; golden?: string }> => {
    const { id, image, mounts, ports } = sandbox;
    const roots = new Set((mounts ?? []).map((entry) => dirname(entry.source)));
    const bootDirectly = async (): Promise<SmolMachine> => {
      const machine = await createMachine({
        name: id,
        image,
        network: true,
        ...(await hostAccess()),
        ...(mounts ? { mounts } : {}),
        ...(ports.length ? { ports } : {}),
      });
      if (ports.length) await machine.exec(["sh", "-c", guestDockerInit]);
      return machine;
    };
    // Every mount must sit under one root for the golden's single mount to cover
    // them, and `machine fork` cannot add one.
    if (roots.size > 1) return { machine: await bootDirectly() };
    const workspacesRoot = [...roots][0] ?? "";
    const name = goldenMachineName(image, workspacesRoot);
    let clone: SmolMachine;
    try {
      await golden(image, workspacesRoot);
      clone = await forkMachine(name, id, ports);
    } catch (error) {
      // The golden may be gone — a host sleep breaking its memfd, or an
      // operator deleting it. Forget it so the next run boots a fresh one
      // rather than falling back for the rest of the process's life.
      goldens.delete(name);
      process.stderr.write(
        `smolvm fork unavailable, booting ${id} directly: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
      return { machine: await bootDirectly() };
    }
    goldens.get(name)?.clones.add(id);
    if (mounts?.length) {
      await clone.exec(["sh", "-c", guestMountIsolation(mounts)]);
    }
    return { machine: clone, golden: name };
  };

  return {
    /**
     * The CLI is the source of truth, so the console also shows machines this
     * process never created — strays a crashed coordinator left behind.
     */
    async listMachines() {
      const listed = await run(["smolvm", "machine", "ls", "--json"]);
      if (listed.exitCode !== 0) return [];
      return Promise.all(
        parseMachineList(listed.stdout).map(async (entry) => {
          const id = entry.name;
          const managed = machines.get(id);
          return {
            id,
            state: entry.state ?? "unknown",
            image: managed?.image ?? entry.image ?? "",
            createdAt: (entry.created_at ?? 0) * 1000,
            mounts: entry.mounts ?? 0,
            network: entry.network ?? false,
            ...(managed?.previewUrl
              ? {
                  previewUrl: managed.previewUrl,
                  previewReady:
                    !managed.previewError &&
                    (await probePreview(managed.previewUrl)),
                }
              : {}),
            ...(managed?.previewError
              ? { previewError: managed.previewError }
              : {}),
            ...(isGoldenMachine(id) ? { golden: true } : {}),
          };
        }),
      );
    },

    async nukeMachine(id) {
      const entry = machines.get(id);
      if (entry) {
        await entry.dispose();
        return true;
      }
      // Deleting a golden is safe: live clones keep running, including their
      // mount. The next run boots a fresh one.
      const base = goldens.get(id);
      if (base?.idle) clearTimeout(base.idle);
      goldens.delete(id);
      return deleteSmolvmMachine(id, run);
    },

    async disposeGoldens() {
      const booted = [...goldens.values()];
      const names = [...goldens.keys()];
      goldens.clear();
      for (const entry of booted) {
        if (entry.idle) clearTimeout(entry.idle);
      }
      await Promise.all(
        names.map((name) =>
          deleteSmolvmMachine(name, run).catch(() => undefined),
        ),
      );
    },

    async machineLogs(id) {
      const entry = machines.get(id);
      if (!entry) return undefined;
      const docker = await entry.machine
        .exec(["cat", "/tmp/dockerd.log"])
        .catch(() => ({ exitCode: 1, stdout: "", stderr: "" }));
      return {
        channels: [
          { name: "preview", text: entry.logs.preview ?? "" },
          { name: "init", text: entry.logs.init ?? "" },
          {
            name: "docker",
            text: docker.exitCode === 0 ? docker.stdout : "",
          },
        ],
      };
    },

    async execMachine(id, command) {
      const result = await run([
        "smolvm",
        "machine",
        "exec",
        "--stream",
        "--name",
        id,
        "--workdir",
        "/work",
        "--",
        "sh",
        "-lc",
        command,
      ]);
      if (smolvmAlreadyGone(`${result.stdout}\n${result.stderr}`))
        return undefined;
      return result;
    },

    async create(spec) {
      const id = createId();
      const publish = await publishedPort(spec, allocatePort);
      const image = await resolveImage(spec.image);
      const mounts = spec.volumes?.map(mount);
      const ports = publish
        ? [{ host: publish.host, guest: publish.guest }]
        : [];
      const { machine, golden: from } = await forkFromGolden({
        id,
        image,
        mounts,
        ports,
      });
      const hostGateway = await guestDefaultGateway(machine);
      let disposal: Promise<void> | undefined;
      const dispose = async () => {
        disposal ??= machine
          .delete()
          .then(() => {
            machines.delete(id);
            if (from) releaseGolden(from, id);
          })
          .catch((error) => {
            disposal = undefined;
            throw error;
          });
        await disposal;
      };
      const logs: { init?: string; preview?: string } = {};
      const entry: ManagedMachine = {
        machine,
        dispose,
        image: spec.image,
        ...(publish ? { previewUrl: publish.url } : {}),
        logs,
      };
      machines.set(id, entry);

      return {
        id,
        ...(publish ? { previewUrl: publish.url } : {}),
        ...(hostGateway ? { hostGateway } : {}),

        async exec(request) {
          const env = envVars({
            ...request.env,
            ...(options.caCertificate
              ? { NODE_EXTRA_CA_CERTS: guestExtraCaCertificate }
              : {}),
          });
          const channel = request.log;
          let streamed = false;
          const retain = (text: string): void => {
            if (!channel || !text) return;
            logs[channel] = tailLog(`${logs[channel] ?? ""}${text}`);
          };
          const onOutput =
            channel || request.onOutput
              ? (chunk: OutputChunk) => {
                  streamed = true;
                  retain(chunk.text);
                  request.onOutput?.(chunk);
                }
              : undefined;
          const result = await machine.exec(request.command, {
            ...(env ? { env } : {}),
            ...(request.workdir ? { workdir: request.workdir } : {}),
            ...(onOutput ? { onOutput } : {}),
          }).catch((error: unknown) => {
            if (channel === "preview") {
              entry.previewError =
                error instanceof Error ? error.message : "Preview failed";
            }
            throw error;
          });
          // A machine that does not stream still has output worth keeping.
          if (!streamed) retain(`${result.stdout}${result.stderr}`);
          if (channel === "preview") {
            entry.previewError = commandFailure("Preview", {
              exitCode: result.exitCode,
              stdout: logs.preview ?? result.stdout,
              stderr: logs.preview ? "" : result.stderr,
            });
          }
          return result;
        },

        async dispose() {
          await dispose();
        },
      };
    },
  };
}

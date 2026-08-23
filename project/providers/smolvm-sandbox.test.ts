import { expect, test } from "bun:test";
import { writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ExecutionResult } from "../sandboxes";
import type { MachineConfig, SmolMachine } from "./smolvm-sandbox";
import {
  createSmolvmMachine,
  createSmolvmSandboxProvider,
  forkSmolvmMachine,
  goldenMachineName,
  guestExtraCaCertificate,
  guestMountIsolation,
  parseDefaultGateway,
  probePreviewUrl,
  resolveSmolvmImage,
  smolvmCreateFlags,
} from "./smolvm-sandbox";
import { allocateHostPort } from "../sandboxes";

const passthroughImage = {
  resolveImage: async (image: string) => image,
};

const succeeds = async (): Promise<ExecutionResult> => ({
  exitCode: 0,
  stdout: "",
  stderr: "",
});

const stubMachine = (overrides: Partial<SmolMachine> = {}): SmolMachine => ({
  exec: succeeds,
  async delete() {},
  ...overrides,
});

type Fork = {
  golden: string;
  name: string;
  ports: ReadonlyArray<{ host: number; guest: number }>;
};

/** Lets a zero-delay reap timer fire before the assertion reads its effect. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

/**
 * A provider that forks: `createMachine` builds the golden once, `forkMachine`
 * hands every sandbox its own clone. Records what each side was asked for, so a
 * test can tell golden setup apart from per-sandbox work.
 */
const forking = (clone: SmolMachine = stubMachine()) => {
  const goldens: MachineConfig[] = [];
  const goldenExecs: string[][] = [];
  const forks: Fork[] = [];
  return {
    goldens,
    goldenExecs,
    forks,
    options: {
      createMachine: async (config: MachineConfig) => {
        goldens.push(config);
        return stubMachine({
          async exec(command) {
            goldenExecs.push([...command]);
            return succeeds();
          },
        });
      },
      forkMachine: async (
        golden: string,
        name: string,
        ports: ReadonlyArray<{ host: number; guest: number }>,
      ) => {
        forks.push({ golden, name, ports });
        return clone;
      },
    },
  };
};

type MachineRow = Partial<{
  name: string;
  state: string;
  image: string;
  created_at: number;
  mounts: number;
  network: boolean;
}>;

/** Stands in for the smolvm CLI, which owns the machine list the console shows. */
const cli = (...rows: MachineRow[]) => ({
  run: async (command: readonly string[]): Promise<ExecutionResult> =>
    command[2] === "ls"
      ? { exitCode: 0, stdout: JSON.stringify(rows), stderr: "" }
      : succeeds(),
});

const row = (overrides: MachineRow = {}): MachineRow => ({
  name: "sandbox-1",
  state: "running",
  image: "local:deadbeef",
  created_at: 1_700_000_000,
  mounts: 1,
  network: true,
  ...overrides,
});

const DEFAULT_ROUTE = [
  "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
  "eth0\t00000000\t0102A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0",
].join("\n");

/** What TSI networking actually shows: a dummy NIC and no default route. */
const TSI_ROUTE = [
  "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT",
  "dummy0\t007100CB\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0",
].join("\n");

test("a guest with no default route reaches the host on localhost", async () => {
  const fork = forking(
    stubMachine({
      async exec(command) {
        if (command[0] === "cat") {
          return { exitCode: 0, stdout: TSI_ROUTE, stderr: "" };
        }
        return succeeds();
      },
    }),
  );
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-tsi",
    ...passthroughImage,
    ...fork.options,
  });

  const sandbox = await provider.create({
    image: "alpine:latest",
    volumes: ["/tmp/work:/work"],
  });

  expect(sandbox.hostGateway).toBe("127.0.0.1");
  await sandbox.dispose();
});

test("a Linux route table yields the default IPv4 gateway", () => {
  expect(parseDefaultGateway(DEFAULT_ROUTE)).toBe("192.168.2.1");
  expect(
    parseDefaultGateway(
      "Iface Destination Gateway Flags\neth0 0101A8C0 00000000 0001\n",
    ),
  ).toBeUndefined();
});

test("a smolvm machine behaves as a sandbox", async () => {
  const execs: Array<Parameters<SmolMachine["exec"]>> = [];
  const chunks: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
  let deletes = 0;
  const fork = forking(
    stubMachine({
      async exec(command, options) {
        execs.push([command, options]);
        if (command[0] === "cat") {
          return { exitCode: 0, stdout: DEFAULT_ROUTE, stderr: "" };
        }
        if (command[0] === "sh") return succeeds();
        options?.onOutput?.({ stream: "stdout", text: "hello\n" });
        options?.onOutput?.({ stream: "stderr", text: "warning\n" });
        return { exitCode: 0, stdout: "hello\n", stderr: "warning\n" };
      },
      async delete() {
        deletes += 1;
      },
    }),
  );
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    ...passthroughImage,
    ...fork.options,
  });

  const sandbox = await provider.create({
    image: "alpine:latest",
    volumes: ["/tmp/work:/work"],
  });
  const result = await sandbox.exec({
    command: ["echo", "hello"],
    env: { MODEL: "test", EMPTY: undefined },
    workdir: "/work",
    onOutput: (chunk) => chunks.push(chunk),
  });
  await sandbox.dispose();

  expect(sandbox.id).toBe("sandbox-1");
  expect(sandbox.hostGateway).toBe("192.168.2.1");
  // The golden mounts the run directories' shared parent, and publishes nothing.
  expect(fork.goldens).toEqual([
    {
      name: goldenMachineName("alpine:latest", "/tmp"),
      image: "alpine:latest",
      network: true,
      forkable: true,
      mounts: [{ source: "/tmp", target: "/mnt/ws", readOnly: false }],
    },
  ]);
  expect(fork.forks).toEqual([
    {
      golden: goldenMachineName("alpine:latest", "/tmp"),
      name: "sandbox-1",
      ports: [],
    },
  ]);
  // Isolation, gateway, then the caller's command.
  expect(execs).toHaveLength(3);
  expect(execs[0]?.[0]).toEqual(["sh", "-c", guestMountIsolation([
    { source: "/tmp/work", target: "/work" },
  ])]);
  expect(execs[1]?.[0]).toEqual(["cat", "/proc/net/route"]);
  expect(execs[2]?.[0]).toEqual(["echo", "hello"]);
  expect(execs[2]?.[1]).toMatchObject({
    env: { MODEL: "test" },
    workdir: "/work",
  });
  expect(result).toEqual({
    exitCode: 0,
    stdout: "hello\n",
    stderr: "warning\n",
  });
  expect(chunks).toEqual([
    { stream: "stdout", text: "hello\n" },
    { stream: "stderr", text: "warning\n" },
  ]);
  expect(deletes).toBe(1);
});

test("disposing a smolvm sandbox twice only removes it once", async () => {
  let deletes = 0;
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    ...passthroughImage,
    ...forking(
      stubMachine({
        async delete() {
          deletes += 1;
        },
      }),
    ).options,
  });

  const sandbox = await provider.create({ image: "alpine:latest" });
  await sandbox.dispose();
  await sandbox.dispose();

  expect(deletes).toBe(1);
});

test("the control pane reports CLI state and the Colony image tag", async () => {
  let deletes = 0;
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    ...passthroughImage,
    ...cli(
      row(),
      row({ name: "stray", state: "stopped", created_at: 1_700_000_009 }),
    ),
    ...forking(
      stubMachine({
        async delete() {
          deletes += 1;
        },
      }),
    ).options,
  });

  await provider.create({
    image: "alpine:latest",
    volumes: ["/tmp/work:/work"],
  });

  expect(await provider.listMachines()).toEqual([
    // Newest first, ahead of the row the CLI happened to list first. A machine
    // this process never created still shows up, and can be nuked.
    expect.objectContaining({
      id: "stray",
      state: "stopped",
      image: "local:deadbeef",
    }),
    expect.objectContaining({
      id: "sandbox-1",
      state: "running",
      image: "alpine:latest",
      createdAt: 1_700_000_000_000,
      mounts: 1,
      network: true,
    }),
  ]);
  expect(await provider.nukeMachine("sandbox-1")).toBe(true);
  expect(deletes).toBe(1);
});

test("nuking a machine this process does not own goes to the CLI", async () => {
  const commands: string[][] = [];
  const provider = createSmolvmSandboxProvider({
    ...passthroughImage,
    run: async (command) => {
      commands.push([...command]);
      return command.includes("ghost")
        ? { exitCode: 1, stdout: "", stderr: "vm not found" }
        : { exitCode: 0, stdout: "", stderr: "" };
    },
  });

  expect(await provider.nukeMachine("stray")).toBe(true);
  expect(await provider.nukeMachine("ghost")).toBe(false);
  expect(commands[0]).toEqual([
    "smolvm",
    "machine",
    "delete",
    "--name",
    "stray",
    "-f",
  ]);
});

test("a failed nuke leaves the machine visible for retry", async () => {
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    ...passthroughImage,
    ...cli(row()),
    ...forking(
      stubMachine({
        async delete() {
          throw new Error("still running");
        },
      }),
    ).options,
  });
  await provider.create({ image: "alpine:latest" });

  await expect(provider.nukeMachine("sandbox-1")).rejects.toThrow(
    "still running",
  );
  expect(await provider.listMachines()).toEqual([
    expect.objectContaining({ id: "sandbox-1", image: "alpine:latest" }),
  ]);
});

test("the golden starts guest dockerd without a host Docker socket", async () => {
  const fork = forking();
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    allocatePort: async () => 49152,
    ...passthroughImage,
    ...fork.options,
  });

  await provider.create({
    image: "sweat-agent-cursor:latest",
    publish: { guestPort: 3000 },
  });

  const init = fork.goldenExecs[0];
  expect(init?.[0]).toBe("sh");
  expect(init?.[2]).toContain("backend = \"copyfile\"");
  expect(init?.[2]).toContain("/storage/bun");
  expect(init?.[2]).toContain("dockerd");
  expect(init?.[2]).toContain("/storage/docker");
  expect(init?.[2]).toContain("native.cgroupdriver=cgroupfs");
  expect(init?.[2]).toContain("did not become ready");
  expect(init?.[2]).not.toContain("docker.sock");
});

test("dockerd is booted once on the golden, not per sandbox", async () => {
  const fork = forking();
  const provider = createSmolvmSandboxProvider({
    createId: () => `sandbox-${fork.forks.length + 1}`,
    allocatePort: async () => 49152,
    ...passthroughImage,
    ...fork.options,
  });

  // A plain run and a published run, in either order, share one golden — so
  // neither pays the daemon start the old per-sandbox path charged Preview runs.
  await provider.create({ image: "sweat-agent-cursor:latest" });
  await provider.create({
    image: "sweat-agent-cursor:latest",
    publish: { guestPort: 3000 },
  });

  expect(fork.goldens).toHaveLength(1);
  expect(fork.goldenExecs).toHaveLength(1);
  expect(fork.forks.map((entry) => entry.name)).toEqual([
    "sandbox-1",
    "sandbox-2",
  ]);
});

test("a smolvm machine publishes a guest port and exposes its Preview URL", async () => {
  const fork = forking();
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    allocatePort: async () => 49152,
    ...passthroughImage,
    ...fork.options,
  });

  const sandbox = await provider.create({
    image: "alpine:latest",
    publish: { guestPort: 3000 },
  });

  expect(sandbox.previewUrl).toBe("http://127.0.0.1:49152");
  // The port is pinned on the clone; the golden publishes none.
  expect(fork.forks[0]?.ports).toEqual([{ host: 49152, guest: 3000 }]);
  expect(fork.goldens[0]?.ports).toBeUndefined();
  await sandbox.dispose();
});

test("smolvm create boots a local image archive instead of a registry pull", async () => {
  const fork = forking();
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    resolveImage: async () => "/tmp/colony-smolvm-images/cursor.tar",
    ...fork.options,
  });

  await provider.create({ image: "sweat-agent-cursor:latest" });
  expect(fork.goldens[0]?.image).toBe("/tmp/colony-smolvm-images/cursor.tar");
});

test("a rebuilt image gets its own golden", async () => {
  const fork = forking();
  const images = ["/tmp/images/old.tar", "/tmp/images/new.tar"];
  const provider = createSmolvmSandboxProvider({
    createId: () => `sandbox-${fork.forks.length + 1}`,
    resolveImage: async () => images[fork.goldens.length] ?? "",
    ...fork.options,
  });

  await provider.create({ image: "sweat-agent-cursor:latest" });
  await provider.create({ image: "sweat-agent-cursor:latest" });

  expect(fork.goldens.map((config) => config.name)).toEqual([
    goldenMachineName("/tmp/images/old.tar", ""),
    goldenMachineName("/tmp/images/new.tar", ""),
  ]);
});

test("a sandbox whose mounts span two roots skips the golden", async () => {
  const fork = forking();
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    ...passthroughImage,
    ...fork.options,
  });

  // One golden mount cannot cover both parents, and `machine fork` adds none.
  await provider.create({
    image: "alpine:latest",
    volumes: ["/tmp/a/work:/work", "/var/b/cache:/cache"],
  });

  expect(fork.forks).toEqual([]);
  expect(fork.goldens).toEqual([
    {
      name: "sandbox-1",
      image: "alpine:latest",
      network: true,
      mounts: [
        { source: "/tmp/a/work", target: "/work", readOnly: false },
        { source: "/var/b/cache", target: "/cache", readOnly: false },
      ],
    },
  ]);
});

test("a sandbox still boots when forking fails", async () => {
  const fork = forking();
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    allocatePort: async () => 49152,
    ...passthroughImage,
    ...fork.options,
    forkMachine: async () => {
      throw new Error("fork unsupported on this host");
    },
  });

  const sandbox = await provider.create({
    image: "alpine:latest",
    volumes: ["/tmp/work:/work"],
    publish: { guestPort: 3000 },
  });

  expect(sandbox.previewUrl).toBe("http://127.0.0.1:49152");
  // The golden attempt, then the sandbox booted the old way with its own mount.
  expect(fork.goldens.map((config) => config.name)).toEqual([
    goldenMachineName("alpine:latest", "/tmp"),
    "sandbox-1",
  ]);
  expect(fork.goldens[1]?.mounts).toEqual([
    { source: "/tmp/work", target: "/work", readOnly: false },
  ]);
  expect(fork.goldens[1]?.ports).toEqual([{ host: 49152, guest: 3000 }]);
});

test("an idle golden is reaped once its last clone goes", async () => {
  const deleted: string[] = [];
  const fork = forking();
  const provider = createSmolvmSandboxProvider({
    createId: () => `sandbox-${fork.forks.length + 1}`,
    ...passthroughImage,
    ...fork.options,
    goldenIdleTtlMs: 0,
    run: async (command) => {
      if (command[2] === "delete") deleted.push(command[4] ?? "");
      return succeeds();
    },
  });
  const name = goldenMachineName("alpine:latest", "");

  const first = await provider.create({ image: "alpine:latest" });
  const second = await provider.create({ image: "alpine:latest" });
  await first.dispose();
  await settle();
  // One clone is still running, so the fork base has to stay.
  expect(deleted.filter((id) => id === name)).toHaveLength(1); // the pre-boot sweep

  await second.dispose();
  await settle();
  expect(deleted.filter((id) => id === name)).toHaveLength(2);
});

test("a run arriving before the reap keeps the golden", async () => {
  const deleted: string[] = [];
  const fork = forking();
  const provider = createSmolvmSandboxProvider({
    createId: () => `sandbox-${fork.forks.length + 1}`,
    ...passthroughImage,
    ...fork.options,
    goldenIdleTtlMs: 10_000,
    run: async (command) => {
      if (command[2] === "delete") deleted.push(command[4] ?? "");
      return succeeds();
    },
  });
  const name = goldenMachineName("alpine:latest", "");

  const first = await provider.create({ image: "alpine:latest" });
  await first.dispose();
  await provider.create({ image: "alpine:latest" });
  await settle();

  // The second run cancelled the pending reap and reused the same golden.
  expect(deleted.filter((id) => id === name)).toHaveLength(1);
  expect(fork.goldens).toHaveLength(1);
  expect(fork.forks).toHaveLength(2);
});

test("a lost golden is forgotten so the next run boots a fresh one", async () => {
  const fork = forking();
  let forks = 0;
  const provider = createSmolvmSandboxProvider({
    createId: () => `sandbox-${++forks}`,
    ...passthroughImage,
    ...fork.options,
    // The golden vanished — a host sleep, or an operator deleting it by hand.
    forkMachine: async (golden, name, ports) => {
      if (forks === 1) throw new Error("vm not found");
      return fork.options.forkMachine(golden, name, ports);
    },
  });

  await provider.create({ image: "alpine:latest" });
  await provider.create({ image: "alpine:latest" });

  // Boot one, fall back, then boot a replacement rather than falling back forever.
  const name = goldenMachineName("alpine:latest", "");
  expect(fork.goldens.map((config) => config.name)).toEqual([
    name,
    "sandbox-1", // the fallback, booted the old way
    name, // rebuilt for the second run
  ]);
  expect(fork.forks.map((entry) => entry.name)).toEqual(["sandbox-2"]);
});

test("a clone binds its own workspace and hides its siblings", () => {
  expect(
    guestMountIsolation([{ source: "/tmp/colony-workspaces/run-a1", target: "/work" }]),
  ).toBe(
    [
      "mkdir -p /work",
      "mount -o bind /mnt/ws/run-a1 /work",
      "mount -t tmpfs none /mnt/ws",
    ].join("\n"),
  );
});

test("goldens are named per image and workspaces root, and marked in the console", async () => {
  expect(goldenMachineName("a.tar", "/tmp/ws")).toBe(
    goldenMachineName("a.tar", "/tmp/ws"),
  );
  expect(goldenMachineName("a.tar", "/tmp/ws")).not.toBe(
    goldenMachineName("b.tar", "/tmp/ws"),
  );
  expect(goldenMachineName("a.tar", "/tmp/ws")).not.toBe(
    goldenMachineName("a.tar", "/other"),
  );

  const golden = goldenMachineName("alpine:latest", "");
  const provider = createSmolvmSandboxProvider({
    ...passthroughImage,
    ...cli(row({ name: golden }), row({ name: "sandbox-1" })),
  });
  const listed = await provider.listMachines();
  expect(listed.find((machine) => machine.id === golden)?.golden).toBe(true);
  expect(listed.find((machine) => machine.id === "sandbox-1")?.golden).toBe(
    undefined,
  );
});

test("disposeGoldens deletes the fork bases this process booted", async () => {
  const commands: string[][] = [];
  const fork = forking();
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    ...passthroughImage,
    ...fork.options,
    run: async (command) => {
      commands.push([...command]);
      return succeeds();
    },
  });
  await provider.create({ image: "alpine:latest" });

  await provider.disposeGoldens();

  const name = goldenMachineName("alpine:latest", "");
  expect(
    commands.filter(
      (command) => command[2] === "delete" && command[4] === name,
    ),
  ).toHaveLength(2); // the stale-golden sweep before boot, then the reap
});

test("machine settings become smolvm create flags", () => {
  expect(
    smolvmCreateFlags({
      name: "sandbox-1",
      image: "/tmp/cursor.tar",
      network: true,
      mounts: [{ source: "/tmp/work", target: "/work", readOnly: false }],
      ports: [{ host: 49152, guest: 3000 }],
    }),
  ).toEqual([
    // A clone forked with `-p` needs the interface only virtio-net gives it.
    "--net",
    "--net-backend",
    "virtio-net",
    "-v",
    "/tmp/work:/work",
    "-p",
    "49152:3000",
  ]);
  expect(
    smolvmCreateFlags({ name: "sandbox-1", image: "alpine", network: false }),
  ).toEqual([]);
  // An internal endpoint needs a resolver that knows the zone and its CA.
  expect(
    smolvmCreateFlags({
      name: "colony-golden-1",
      image: "alpine",
      network: true,
      dns: "10.0.0.53",
      caDirectory: "/tmp/colony-smolvm-ca",
    }),
  ).toEqual([
    "--net",
    "--net-backend",
    "virtio-net",
    "--dns",
    "10.0.0.53",
    "-v",
    `/tmp/colony-smolvm-ca:${dirname(guestExtraCaCertificate)}:ro`,
  ]);
  // Unset means smolvm's own 8192/4, so the flags must carry a set size through
  // rather than dropping it and leaving every sandbox on the default.
  expect(
    smolvmCreateFlags({
      name: "colony-golden-1",
      image: "alpine",
      network: false,
      mem: 4096,
      cpus: 2,
    }),
  ).toEqual(["--mem", "4096", "--cpus", "2"]);
});

test("a sized provider boots goldens and fallbacks at that size", async () => {
  const configs: MachineConfig[] = [];
  const provider = createSmolvmSandboxProvider({
    ...passthroughImage,
    mem: 4096,
    cpus: 2,
    createMachine: async (config) => {
      configs.push(config);
      return stubMachine();
    },
    // No fork support, so this also exercises the direct-boot fallback.
    forkMachine: async () => {
      throw new Error("forking unavailable");
    },
    run: succeeds,
  });
  const sandbox = await provider.create({ image: "alpine" });

  expect(configs.length).toBeGreaterThan(0);
  for (const config of configs) {
    expect(config.mem).toBe(4096);
    expect(config.cpus).toBe(2);
  }
  await sandbox.dispose();
});

test("a private CA reaches the golden's guest and every exec in its clones", async () => {
  const execs: Array<Parameters<SmolMachine["exec"]>> = [];
  const fork = forking(
    stubMachine({
      async exec(command, options) {
        execs.push([command, options]);
        return succeeds();
      },
    }),
  );
  const certificate = join(await mkdtemp(join(tmpdir(), "colony-ca-")), "ca.pem");
  await writeFile(certificate, "--- a company CA ---");
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-ca",
    caCertificate: certificate,
    dns: "10.0.0.53",
    ...passthroughImage,
    ...fork.options,
  });

  const sandbox = await provider.create({ image: "alpine:latest" });
  const result = await sandbox.exec({ command: ["node", "-e", ""] });

  // Staged alone under a fixed name: virtiofs mounts directories, not files.
  expect(fork.goldens[0]?.dns).toBe("10.0.0.53");
  const staged = fork.goldens[0]?.caDirectory ?? "";
  expect(await Bun.file(join(staged, basename(guestExtraCaCertificate))).text())
    .toBe("--- a company CA ---");
  expect(execs.at(-1)?.[1]?.env).toMatchObject({
    NODE_EXTRA_CA_CERTS: guestExtraCaCertificate,
  });
  expect(result.exitCode).toBe(0);
  await sandbox.dispose();
});

test("an agent CA path must be absolute", () => {
  expect(() =>
    createSmolvmSandboxProvider({ caCertificate: "certs/company.pem" }),
  ).toThrow(/absolute/);
});

test("Preview is ready only when the host URL answers HTTP", async () => {
  const port = await allocateHostPort();
  const url = `http://127.0.0.1:${port}`;
  expect(await probePreviewUrl(url)).toBe(false);
  const server = Bun.serve({
    port,
    fetch() {
      return new Response("ok");
    },
  });
  try {
    expect(await probePreviewUrl(url)).toBe(true);
  } finally {
    await server.stop(true);
  }
});

const cliConfig: MachineConfig = {
  name: "sandbox-1",
  image: "/tmp/cursor.tar",
  network: true,
};

test("a CLI-backed machine creates, starts, execs and deletes through smolvm", async () => {
  const commands: string[][] = [];
  const machine = await createSmolvmMachine(cliConfig, async (command) => {
    commands.push([...command]);
    return { exitCode: 0, stdout: "", stderr: "" };
  });
  await machine.exec(["bun", "run", "agent"], {
    env: { MODEL: "test" },
    workdir: "/work",
  });
  await machine.delete();

  expect(commands).toEqual([
    [
      "smolvm",
      "machine",
      "create",
      "--name",
      "sandbox-1",
      "--image",
      "/tmp/cursor.tar",
      "--net",
      "--net-backend",
      "virtio-net",
    ],
    ["smolvm", "machine", "start", "--name", "sandbox-1"],
    [
      "smolvm",
      "machine",
      "exec",
      "--stream",
      "--name",
      "sandbox-1",
      "--workdir",
      "/work",
      "--env",
      "MODEL=test",
      "--",
      "bun",
      "run",
      "agent",
    ],
    ["smolvm", "machine", "delete", "--name", "sandbox-1", "-f"],
  ]);
});

test("a fork base starts forkable and clones pin their own ports", async () => {
  const commands: string[][] = [];
  const run = async (command: readonly string[]) => {
    commands.push([...command]);
    return succeeds();
  };

  await createSmolvmMachine({ ...cliConfig, forkable: true }, run);
  await forkSmolvmMachine(
    "colony-golden-abc",
    "sandbox-1",
    [{ host: 49152, guest: 3000 }],
    run,
  );

  expect(commands[1]).toEqual([
    "smolvm",
    "machine",
    "start",
    "--name",
    "sandbox-1",
    "--forkable",
  ]);
  expect(commands[2]).toEqual([
    "smolvm",
    "machine",
    "fork",
    "--golden",
    "colony-golden-abc",
    "--name",
    "sandbox-1",
    "-p",
    "49152:3000",
  ]);
});

test("a failed fork reports the command that failed", async () => {
  await expect(
    forkSmolvmMachine("colony-golden-abc", "sandbox-1", [], async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "golden is not forkable",
    })),
  ).rejects.toThrow("golden is not forkable");
});

test("a machine that fails to start is deleted instead of left behind", async () => {
  const commands: string[][] = [];
  await expect(
    createSmolvmMachine(cliConfig, async (command) => {
      commands.push([...command]);
      return command[2] === "start"
        ? { exitCode: 1, stdout: "", stderr: "no such image" }
        : { exitCode: 0, stdout: "", stderr: "" };
    }),
  ).rejects.toThrow(/no such image/);

  expect(commands.at(-1)).toEqual([
    "smolvm",
    "machine",
    "delete",
    "--name",
    "sandbox-1",
    "-f",
  ]);
});

test("a machine whose smolvm data directory is not empty is force-removed", async () => {
  const leftover = join(
    tmpdir(),
    `colony-smolvm-vms-${crypto.randomUUID()}`,
    "smolvm",
    "vms",
    "8ff950cb92be49cc",
  );
  await mkdir(leftover, { recursive: true });
  await writeFile(join(leftover, "disk.img"), "busy");
  let deletes = 0;
  const machine = await createSmolvmMachine(cliConfig, async (command) => {
    if (command[2] === "delete") {
      deletes += 1;
      if (deletes === 1) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: `storage operation failed: delete machine data: ${leftover}: Directory not empty (os error 66)`,
        };
      }
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  });
  await machine.delete();
  expect(deletes).toBe(2);
  expect(await Bun.file(join(leftover, "disk.img")).exists()).toBe(false);
});

test("deleting an already-removed smolvm machine succeeds", async () => {
  const machine = await createSmolvmMachine(cliConfig, async (command) => {
    if (command[2] === "delete") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "Error: vm not found: sandbox-1",
      };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  });
  await machine.delete();
});

test("resolveSmolvmImage exports a local Docker tag to a tar archive", async () => {
  const commands: string[][] = [];
  const id = `test${crypto.randomUUID().replaceAll("-", "")}`;
  const image = await resolveSmolvmImage(
    "sweat-agent-cursor:latest",
    async (command) => {
      commands.push([...command]);
      if (command[1] === "image" && command[2] === "inspect") {
        return {
          exitCode: 0,
          stdout: `sha256:${id}\n`,
          stderr: "",
        };
      }
      if (command[1] === "save") {
        const tar = command[command.indexOf("-o") + 1];
        await writeFile(tar, "oci-archive");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      return { exitCode: 1, stdout: "", stderr: "unused" };
    },
  );
  expect(image).toMatch(new RegExp(`${id}\\.tar$`));
  expect(commands[0]?.slice(0, 3)).toEqual(["docker", "image", "inspect"]);
  expect(commands[1]?.slice(0, 2)).toEqual(["docker", "save"]);
});

test("resolveSmolvmImage rejects an Apple Container OCI archive", async () => {
  const commands: string[][] = [];
  await expect(
    resolveSmolvmImage("sweat-agent:latest", async (command) => {
      commands.push([...command]);
      return command.slice(0, 3).join(" ") === "container image inspect"
        ? { exitCode: 0, stdout: '[{"id":"sha256:test"}]', stderr: "" }
        : { exitCode: 1, stdout: "", stderr: "unused" };
    }),
  ).rejects.toThrow(/SWEAT_CONTAINER_PROVIDER=docker/);
  expect(commands.at(-1)?.slice(0, 3)).toEqual([
    "container",
    "image",
    "inspect",
  ]);
});

test("resolveSmolvmImage refuses a short name that is not a local image", async () => {
  await expect(
    resolveSmolvmImage("sweat-agent-cursor:latest", async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "No such image",
    })),
  ).rejects.toThrow(/Run make agent/);
});

test("resolveSmolvmImage leaves registry references to crane when they are not local", async () => {
  await expect(
    resolveSmolvmImage(
      "ghcr.io/4ug-aug/sweat-v2-agent-cursor:latest",
      async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "No such image",
      }),
    ),
  ).resolves.toBe("ghcr.io/4ug-aug/sweat-v2-agent-cursor:latest");
});

test("a smolvm machine retains init and Preview output for the Machine console", async () => {
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    allocatePort: async () => 49152,
    ...passthroughImage,
    probePreview: async () => false,
    ...cli(row()),
    ...forking(
      stubMachine({
        async exec(command, options) {
          if (command[0] === "cat") {
            return {
              exitCode: 0,
              stdout: "dockerd ready\n",
              stderr: "",
            };
          }
          options?.onOutput?.({ stream: "stdout", text: `${command.at(-1)}\n` });
          return {
            exitCode: 0,
            stdout: `${command.at(-1)}\n`,
            stderr: "",
          };
        },
      }),
    ).options,
  });

  const sandbox = await provider.create({
    image: "alpine:latest",
    publish: { guestPort: 3000 },
  });
  await sandbox.exec({
    command: ["sh", "-lc", "npm install"],
    log: "init",
  });
  await sandbox.exec({
    command: ["sh", "-lc", "make dev"],
    log: "preview",
  });
  await sandbox.exec({ command: ["bun", "run", "agent"] });

  expect(await provider.machineLogs("sandbox-1")).toEqual({
    channels: [
      { name: "preview", text: "make dev\n" },
      { name: "init", text: "npm install\n" },
      { name: "docker", text: "dockerd ready\n" },
    ],
  });
  expect(await provider.machineLogs("missing")).toBeUndefined();
  expect(await provider.listMachines()).toEqual([
    expect.objectContaining({
      id: "sandbox-1",
      previewUrl: "http://127.0.0.1:49152",
      previewReady: false,
      previewError: expect.stringContaining("Preview failed with code 0"),
    }),
  ]);
});

test("a Preview command that exits is reported as a Preview error", async () => {
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    allocatePort: async () => 49152,
    ...passthroughImage,
    probePreview: async () => true,
    ...cli(row()),
    ...forking(
      stubMachine({
        async exec(command, options) {
          if (command.some((part) => part.includes("make"))) {
            options?.onOutput?.({
              stream: "stderr",
              text: "make: *** [Makefile:31: env] Error 2\n",
            });
            return {
              exitCode: 2,
              stdout: "",
              stderr: "make: *** [Makefile:31: env] Error 2\n",
            };
          }
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    ).options,
  });
  const sandbox = await provider.create({
    image: "alpine:latest",
    publish: { guestPort: 3000 },
  });
  await sandbox.exec({
    command: ["sh", "-lc", "make dev"],
    log: "preview",
  });
  expect(await provider.listMachines()).toEqual([
    expect.objectContaining({
      previewReady: false,
      previewError: expect.stringContaining("Error 2"),
    }),
  ]);
});

test("a live Preview command is not an error while it is still running", async () => {
  const provider = createSmolvmSandboxProvider({
    createId: () => "sandbox-1",
    allocatePort: async () => 49152,
    ...passthroughImage,
    probePreview: async (url) => url === "http://127.0.0.1:49152",
    ...cli(row()),
    ...forking(
      stubMachine({
        async exec(command) {
          if (command.some((part) => part.includes("make")))
            return new Promise(() => {});
          return { exitCode: 0, stdout: "", stderr: "" };
        },
      }),
    ).options,
  });
  const sandbox = await provider.create({
    image: "alpine:latest",
    publish: { guestPort: 3000 },
  });
  void sandbox.exec({
    command: ["sh", "-lc", "make dev"],
    log: "preview",
  });
  expect(await provider.listMachines()).toEqual([
    expect.objectContaining({
      previewReady: true,
    }),
  ]);
  expect((await provider.listMachines())[0]?.previewError).toBeUndefined();
});

test("execMachine runs sh -lc in /work", async () => {
  const commands: string[][] = [];
  const provider = createSmolvmSandboxProvider({
    run: async (command) => {
      commands.push([...command]);
      const name = command[command.indexOf("--name") + 1];
      const script = command.at(-1);
      if (name === "ghost")
        return { exitCode: 1, stdout: "", stderr: "vm not found" };
      if (script === "false")
        return { exitCode: 1, stdout: "", stderr: "nope" };
      return { exitCode: 0, stdout: "ok\n", stderr: "" };
    },
  });

  expect(await provider.execMachine("sandbox-1", "ls")).toEqual({
    exitCode: 0,
    stdout: "ok\n",
    stderr: "",
  });
  expect(commands[0]).toEqual([
    "smolvm",
    "machine",
    "exec",
    "--stream",
    "--name",
    "sandbox-1",
    "--workdir",
    "/work",
    "--",
    "sh",
    "-lc",
    "ls",
  ]);
  expect(await provider.execMachine("ghost", "ls")).toBeUndefined();
  expect(await provider.execMachine("sandbox-1", "false")).toEqual({
    exitCode: 1,
    stdout: "",
    stderr: "nope",
  });
});

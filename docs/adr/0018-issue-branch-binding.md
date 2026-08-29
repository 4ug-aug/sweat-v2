# Issue branch binding

Issues may optionally bind a repository branch. When an Issue-linked run
starts and that binding is set (or inherited from the nearest ancestor), the
platform prepares the Git workspace from that branch instead of only the
workspace default base. Publish keeps a platform-assigned run branch; the pull
request targets the Issue branch as its merge base so child work can integrate
into the initiative line before that line merges to the repository default.
We rejected keeping branch identity only on parent Issues: that forces every
multi-Issue initiative into one inheritance rule. We also rejected treating
the Issue branch as only a start snapshot while still PRing into the repository
default: that skips the integration line the binding is meant to provide. A
child run in a tree with no branch binds `sweat/issue/COL-N` on the root so
siblings share a line;
landing that line to the default base remains out of band. An Issue integrate
run prepares its Git workspace from that line merged with each direct child's
published head (the child's own Issue branch). If the heads do not merge
cleanly, the run fails. The agent still opens one pull request into the line;
we rejected merging child pull requests on GitHub or landing child commits
onto the remote Issue branch before the agent works.

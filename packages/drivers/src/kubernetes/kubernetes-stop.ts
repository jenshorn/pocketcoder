export async function stopKubernetesJob(run: (args: string[]) => Promise<string>, name: string, graceSeconds: number) {
  const job = await run(["get", "job", name, "--ignore-not-found", "-o", "name"]);
  if (job) await run(["patch", "job", name, "--type=merge", "-p", '{"spec":{"suspend":true}}']);
  await run([
    "delete",
    "pod",
    "-l",
    `job-name=${name}`,
    `--grace-period=${graceSeconds}`,
    "--wait=true",
    "--ignore-not-found",
  ]);
}

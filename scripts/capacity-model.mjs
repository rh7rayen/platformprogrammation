// Arithmetic planning tool only. This never opens network connections or starts load.
const defaults = {
  concurrent: 1000, activeRatio: 0.7, saveSeconds: 10, pollSeconds: 20,
  runsPerMinute: 1, runCpuSeconds: 2, cpuUtilization: 0.65, sourceBytes: 4096,
  videoRatio: 0.25, videoKbps: 250, segmentSeconds: 15, sessionMinutes: 90,
  sessionsPerDay: 3, retentionDays: 30, apiRpsPerReplica: 0,
  vcpuHourPrice: 0, storageGbMonthPrice: 0, egressGbPrice: 0, reviewRatio: 0.1,
};
const input = { ...defaults };
for (const argument of process.argv.slice(2)) {
  if (argument === '--help') {
    console.log('Usage: node scripts/capacity-model.mjs --concurrent=1000 --videoRatio=0.25\nParameters and defaults:');
    console.log(JSON.stringify(defaults, null, 2));
    process.exit(0);
  }
  const match = argument.match(/^--([a-zA-Z]+)=([\d.]+)$/);
  if (!match || !(match[1] in input) || !Number.isFinite(Number(match[2]))) throw new Error(`Invalid parameter: ${argument}`);
  input[match[1]] = Number(match[2]);
}
for (const name of ['saveSeconds','pollSeconds','cpuUtilization','segmentSeconds','sessionMinutes']) if (input[name] <= 0) throw new Error(`${name} must be positive`);
for (const name of ['activeRatio','videoRatio','cpuUtilization','reviewRatio']) if (input[name] > 1) throw new Error(`${name} must be <= 1`);
const active = input.concurrent * input.activeRatio;
const saves = active / input.saveSeconds;
const polls = input.concurrent / input.pollSeconds;
const executions = active * input.runsPerMinute / 60;
const videoStudents = input.concurrent * input.videoRatio;
const videoGbHour = videoStudents * input.videoKbps * 1000 / 8 * 3600 / 1e9;
const videoGbDay = videoGbHour * input.sessionMinutes / 60 * input.sessionsPerDay;
const cpu = executions * input.runCpuSeconds / input.cpuUtilization;
const chunkReservations = videoStudents / input.segmentSeconds;
const requests = saves + polls + executions + 2 * chunkReservations;
const storageGb = videoGbDay * input.retentionDays;
const billableHoursDay = input.sessionMinutes / 60 * input.sessionsPerDay;
const costs = {
  runnerCpuMonth: input.vcpuHourPrice ? cpu * billableHoursDay * 30 * input.vcpuHourPrice : null,
  videoStorageMonth: input.storageGbMonthPrice ? storageGb * input.storageGbMonthPrice : null,
  videoReviewEgressMonth: input.egressGbPrice ? videoGbDay * 30 * input.reviewRatio * input.egressGbPrice : null,
};
console.log(JSON.stringify({
  type: 'ASSUMPTION_MODEL_NOT_A_BENCHMARK', assumptions: input,
  estimates: {
    simultaneousActiveStudents: active, saveRequestsPerSecond: saves,
    pollingRequestsPerSecond: polls, executionStartsPerSecond: executions,
    recordingReservationsAndConfirmationsPerSecond: 2 * chunkReservations,
    baselineApiRequestsPerSecond: requests, answerPayloadBytesPerSecond: saves * input.sourceBytes,
    averageRunnerVcpus: cpu, videoIngressGbPerHour: videoGbHour, videoGbPerDay: videoGbDay,
    retainedVideoGbAtSteadyState: storageGb,
    videoMetadataRowsPerDay: chunkReservations * input.sessionMinutes * 60 * input.sessionsPerDay,
    apiReplicasBeforeRedundancy: input.apiRpsPerReplica ? Math.ceil(requests / input.apiRpsPerReplica) : null,
  }, partialMonthlyCostAtUserSuppliedPrices: costs,
  excluded: ['login and exam-start bursts','submission-deadline bursts','execution polling','AI requests','database WAL/index/replication overhead','compiler RAM','network peak and burst allowance','API/DB/auth/email/object-operation charges','replication/backups','idle capacity','staff and incident response'],
}, null, 2));

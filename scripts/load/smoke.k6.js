// LOCAL ONLY: bounded readiness check. This is not an exam-capacity benchmark.
import http from 'k6/http';
import { check, sleep } from 'k6';

const base = __ENV.BASE_URL || 'http://127.0.0.1:4000';
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) throw new Error('This smoke script accepts only a local HTTP server.');
const vus = Number(__ENV.VUS || 2), seconds = Number(__ENV.SECONDS || 15);
if (!Number.isInteger(vus) || vus < 1 || vus > 10 || !Number.isInteger(seconds) || seconds < 1 || seconds > 60) throw new Error('Limits: 1–10 VUs, 1–60 seconds.');
export const options = {
  vus, duration: `${seconds}s`, maxRedirects: 0,
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<1000'], checks: ['rate==1'] },
};
export default function () {
  const response = http.get(`${base}/api/v1/health/ready`, { timeout: '3s' });
  check(response, { 'API and database ready': r => r.status === 200 && r.json('status') === 'ready' });
  sleep(1);
}

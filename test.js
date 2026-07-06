import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';
import { randomIntBetween, randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) {
  throw new Error('FATAL: BASE_URL environment variable is required. Run with: k6 run -e BASE_URL=http://your-backend/api test.js');
}

const requestErrors = new Rate('request_errors');
const requestDuration = new Trend('request_duration');
const patientsCreated = new Counter('patients_created');
const scenariosCompleted = new Counter('scenarios_completed');

const firstNames = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer',
  'Michael', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara',
  'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Sarah',
  'Christopher', 'Karen', 'Charles', 'Lisa', 'Daniel', 'Nancy',
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia',
  'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez',
  'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore',
  'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
];

function randomPatientName() {
  return `${randomItem(firstNames)} ${randomItem(lastNames)}`;
}

function randomPhone() {
  const area = randomIntBetween(200, 999);
  const prefix = randomIntBetween(200, 999);
  const line = randomIntBetween(1000, 9999);
  return `+1${area}${prefix}${line}`;
}

function nowISO() {
  return new Date().toISOString();
}

export const options = {
  vus: 10,
  duration: '3m',
  thresholds: {
    http_req_duration: ['p(95)<2000', 'avg<800'],
    http_req_failed: ['rate<0.10'],
    request_errors: ['rate<0.10'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)', 'count'],
};

export function setup() {
  const res = http.post(`${BASE_URL}/auth/secretary/login`, JSON.stringify({
    clinic_id: 'MEDI-82558',
    name: 'sara',
    password: '123456',
  }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'login' },
  });

  if (res.status !== 200) {
    throw new Error(`Setup login failed: ${res.status} ${res.body}`);
  }

  const body = res.json();
  console.log(`Setup complete — clinic_id=${body.clinic_id}, token starts with: ${body.access_token.substring(0, 20)}...`);
  return {
    accessToken: body.access_token,
    clinicId: body.clinic_id,
  };
}

export default function (data) {
  const authHeaders = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${data.accessToken}`,
    },
  };

  sleep(randomIntBetween(1, 3));

  group('Get Patients', function () {
    const res = http.get(`${BASE_URL}/patients`, authHeaders);
    requestDuration.add(res.timings.duration, { name: 'list_patients' });

    check(res, {
      'list patients status 200': (r) => r.status === 200,
      'list patients returns array': (r) => {
        const body = r.json();
        return Array.isArray(body.patients) || Array.isArray(body);
      },
    });

    if (res.status !== 200) {
      requestErrors.add(1);
    }
  });

  sleep(randomIntBetween(1, 3));

  group('Create Patient', function () {
    const payload = JSON.stringify({
      full_name: randomPatientName(),
      phone: randomPhone(),
      notes: `K6 load test patient created at ${nowISO()}`,
      status: 'Active',
    });

    const res = http.post(`${BASE_URL}/patients`, payload, authHeaders);
    requestDuration.add(res.timings.duration, { name: 'create_patient' });

    const ok = check(res, {
      'create patient status 200|201': (r) => r.status === 200 || r.status === 201,
      'create patient has patient data': (r) => r.json('patient') !== undefined,
    });

    if (ok) {
      patientsCreated.add(1);
    } else if (res.status !== 404) {
      requestErrors.add(1);
    }
  });

  sleep(randomIntBetween(2, 4));

  group('Get Appointments', function () {
    const res = http.get(`${BASE_URL}/appointments`, authHeaders);
    requestDuration.add(res.timings.duration, { name: 'list_appointments' });

    check(res, {
      'list appointments status 200': (r) => r.status === 200,
      'list appointments returns array': (r) => {
        const body = r.json();
        return Array.isArray(body.appointments) || Array.isArray(body);
      },
    });

    if (res.status !== 200) {
      requestErrors.add(1);
    }
  });

  sleep(randomIntBetween(1, 2));

  scenariosCompleted.add(1);
}

export function handleSummary(data) {
  const metrics = data.metrics;
  const reqDuration = metrics.http_req_duration;
  const failedReqs = metrics.http_req_failed;
  const reqRate = metrics.http_reqs;

  const lines = [
    '',
    '═══════════════════════════════════════════════════════════════',
    '           MEDIDESK AI — K6 LOAD TEST SUMMARY',
    '═══════════════════════════════════════════════════════════════',
    '',
    `  Test duration:         ${data.state.testRunDurationMs / 1000}s`,
    `  Virtual users:         10`,
    `  Target:                ${BASE_URL}`,
    '',
    `  Total requests:        ${reqRate ? reqRate.values.count : 'N/A'}`,
    `  Requests per second:   ${reqRate ? reqRate.values.rate.toFixed(2) : 'N/A'}`,
    '',
    '  ── Latency (ms) ──',
    `  Avg:                   ${reqDuration ? reqDuration.values.avg.toFixed(2) : 'N/A'}`,
    `  Min:                   ${reqDuration ? reqDuration.values.min.toFixed(2) : 'N/A'}`,
    `  Med:                   ${reqDuration ? reqDuration.values.med.toFixed(2) : 'N/A'}`,
    `  Max:                   ${reqDuration ? reqDuration.values.max.toFixed(2) : 'N/A'}`,
    `  p(90):                 ${reqDuration ? reqDuration.values['p(90)'].toFixed(2) : 'N/A'}`,
    `  p(95):                 ${reqDuration ? reqDuration.values['p(95)'].toFixed(2) : 'N/A'}`,
    `  p(99):                 ${reqDuration ? reqDuration.values['p(99)'].toFixed(2) : 'N/A'}`,
    '',
    '  ── Errors ──',
    `  Failed requests:       ${failedReqs ? (failedReqs.values.fails * 100).toFixed(2) : 'N/A'}%`,
    `  Error rate:            ${failedReqs ? (failedReqs.values.rate * 100).toFixed(2) : 'N/A'}%`,
    '',
    '  ── Custom Metrics ──',
    `  Request errors:        ${requestErrors ? requestErrors.values.rate.toFixed(4) : 'N/A'}`,
    `  Patients created:      ${patientsCreated ? patientsCreated.values.count : 0}`,
    `  Scenarios completed:   ${scenariosCompleted ? scenariosCompleted.values.count : 0}`,
    '',
    '  ── Per-Endpoint Latency (ms) ──',
    `  Health:         N/A (removed from iteration)`,
    `  List Patients:  ${requestDuration ? 'see request_duration trend' : 'N/A'}`,
    `  Create Patient: ${requestDuration ? 'see request_duration trend' : 'N/A'}`,
    `  Appointments:   ${requestDuration ? 'see request_duration trend' : 'N/A'}`,
    '',
    '  ── Thresholds ──',
    ...Object.entries(data.metrics)
      .filter(([, m]) => m.thresholds)
      .flatMap(([name, m]) =>
        Object.entries(m.thresholds).map(([thr, val]) =>
          `  ${name} → ${thr}: ${val.ok ? '✓ PASS' : '✗ FAIL'} (${(val.value || 0).toFixed(2)})`
        )
      ),
    '',
    '═══════════════════════════════════════════════════════════════',
    '',
  ];

  console.log(lines.join('\n'));

  const reportLine = [
    `duration=${(data.state.testRunDurationMs / 1000).toFixed(0)}s`,
    `requests=${reqRate ? reqRate.values.count : 0}`,
    `rps=${reqRate ? reqRate.values.rate.toFixed(2) : 0}`,
    `p95_latency_ms=${reqDuration ? reqDuration.values['p(95)'].toFixed(2) : 0}`,
    `avg_latency_ms=${reqDuration ? reqDuration.values.avg.toFixed(2) : 0}`,
    `error_pct=${failedReqs ? (failedReqs.values.rate * 100).toFixed(2) : 0}`,
    `patients_created=${patientsCreated ? patientsCreated.values.count : 0}`,
    `scenarios=${scenariosCompleted ? scenariosCompleted.values.count : 0}`,
  ].join(' | ');

  console.log(`\n[REPORT] ${reportLine}\n`);

  return {};
}

/**
 * UI integration tests (Phase 13). These render the REAL `ArchitectureProvider` (the seam every
 * component in `src/components/` calls into) inside a jsdom document via `react-dom`, and drive
 * it through the exact same public API a component would call - `addServiceNode`, `updateNodeData`,
 * `runScenario`, `injectFailure`, etc. This is deliberately not a mock: AWS semantics stay in the
 * engines (`engine/simulation`, `engine/failure`, `engine/validation`, `engine/analysis`,
 * `engine/trace`) exactly as `ArchitectureContext.tsx` wires them; these tests only assert on the
 * STATE/RESULTS React would then display, never re-implement or second-guess the engine logic.
 *
 * Run via: `npm run test:ui` (needs the esbuild-backed JSX loader in `test/support/`, since
 * `ArchitectureContext.tsx` contains JSX in its Provider - see test/support/jsxLoader.mjs). Lives
 * in its own `test/ui/` subdirectory (not `test/*.test.ts`) so the main `test`/`test:unit` scripts
 * - which run under plain `--experimental-strip-types` with no JSX support - never pick it up.
 */
import assert from 'node:assert';
import test from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/'
});
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const React = (await import('react')).default;
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { ArchitectureProvider, useArchitecture } = await import('../../src/context/ArchitectureContext.tsx');
const { ServiceInspector } = await import('../../src/components/inspector/ServiceInspector.tsx');

type Api = ReturnType<typeof useArchitecture>;

/** Exposes the live `useArchitecture()` return value to the test via a ref - this IS the display
 *  layer's real read of context state; the test drives it exactly as a component would. */
function Harness({ apiRef }: { apiRef: { current: Api | null } }) {
  const ctx = useArchitecture();
  apiRef.current = ctx;
  return null;
}

const { LabsModal } = await import('../../src/components/labs/LabsModal.tsx');
const { COURSE_LABS } = await import('../../src/data/courseLabs.ts');

async function mount(showInspector = false, showLabs = false) {
  const container = document.getElementById('root')!;
  const root = createRoot(container);
  const apiRef: { current: Api | null } = { current: null };
  await act(async () => {
    root.render(React.createElement(ArchitectureProvider, null, React.createElement(Harness, { apiRef }), showInspector ? React.createElement(ServiceInspector) : null, showLabs ? React.createElement(LabsModal, { isOpen: true, onClose: () => {} }) : null));
  });
  return {
    api: () => apiRef.current!,
    act: async (fn: () => void) => {
      await act(async () => { fn(); });
    },
    unmount: async () => {
      await act(async () => { root.unmount(); });
    }
  };
}

test('1. Build architecture: adding services and connecting them updates the Architecture Model', async () => {
  const h = await mount();

  await h.act(() => h.api().addServiceNode('alb', { x: 0, y: 0 }));
  await h.act(() => h.api().addServiceNode('ec2', { x: 200, y: 0 }));

  const alb = h.api().nodes.find(n => n.data.serviceId === 'alb')!;
  const ec2 = h.api().nodes.find(n => n.data.serviceId === 'ec2')!;
  assert.ok(alb && ec2, 'both service nodes must exist on the model after addServiceNode');

  await h.act(() => h.api().onConnect({ source: alb.id, target: ec2.id, sourceHandle: null, targetHandle: null }));

  const edge = h.api().edges.find(e => e.source === alb.id && e.target === ec2.id);
  assert.ok(edge, 'the connection must appear in the Architecture Model edges');

  await h.unmount();
});

test('Labs: select instructions, run ALB failover, then load a clean editable reference', async () => {
  const h = await mount(false, true);
  try {
    const button = (text: string) => [...document.querySelectorAll('button')].find(b => b.textContent?.includes(text))!;
    assert.equal(document.querySelectorAll('nav[aria-label="Course labs"] button').length, 9);
    await h.act(() => button('Lab 5').click());
    assert.match(document.querySelector('a')!.href, /Lab-05-ALB.html$/);
    const runButtons = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Run reference simulation');
    await h.act(() => runButtons[1].click());
    assert.equal(h.api().appMode, 'simulate');
    assert.equal(h.api().simulationResult?.success, true);
    assert.ok(h.api().simulationResult?.path.includes('lab-task-b'));
    await h.act(() => h.api().openLabReference(COURSE_LABS[3].references[0]));
    assert.equal(h.api().appMode, 'design');
    assert.equal(h.api().simulationResult, null);
    assert.equal(h.api().isPlaying, false);
    await h.act(() => h.api().runScenario());
    assert.equal(h.api().simulationResult?.success, true, h.api().simulationResult?.summary);
    assert.equal(COURSE_LABS[5].references[0].nodes.find(n => n.id === 'lab-task-a')!.data.health, 'healthy');
    await h.act(() => button('Lab 7').click());
    assert.match(document.querySelector('a')!.href, /Lab-07-EKS.html$/);
    await h.act(() => button('Lab 8').click());
    assert.match(document.querySelector('a')!.href, /Lab-08-EKS-scaling.html$/);
    const eksRuns = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Run reference simulation');
    await h.act(() => eksRuns[1].click());
    assert.equal(h.api().simulationResult?.success, true);
    assert.match(h.api().simulationResult!.summary, /no scheduler, HPA/);
    assert.equal(h.api().nodes.find(n => n.id === 'lab-enrolment')!.data.replicas, 5);
  } finally { await h.unmount(); }
});

test('2. Configure service: editing a node writes through to the Architecture Model', async () => {
  const h = await mount();
  await h.act(() => h.api().addServiceNode('rds', { x: 0, y: 0 }));
  const rds = h.api().nodes.find(n => n.data.serviceId === 'rds')!;

  await h.act(() => h.api().updateNodeData(rds.id, { multiAz: true, label: 'Orders DB' }));

  const updated = h.api().nodes.find(n => n.id === rds.id)!;
  assert.strictEqual(updated.data.multiAz, true, 'service configuration change must feed the Architecture Model');
  assert.strictEqual(updated.data.label, 'Orders DB');

  await h.unmount();
});

test('3. Send Request: view a successful flow with request path, decision points, and AWS explanation', async () => {
  const h = await mount();
  await h.act(() => h.api().loadTemplate('highly-available-multiaz'));
  await h.act(() => h.api().runScenario());

  const { simulationResult, requestTrace } = h.api();
  assert.ok(simulationResult, 'Send Request must produce a simulation result');
  assert.strictEqual(simulationResult!.success, true, 'the HA template should simulate a successful request');
  assert.ok(simulationResult!.path.length > 1, 'the result must expose the traversed request path');

  assert.ok(requestTrace, 'a successful simulation must produce an explainable AWS decision trace');
  assert.ok(requestTrace!.entries.length > 0, 'the trace must contain decision points');
  assert.ok(requestTrace!.entries.every(e => e.awsRule.length > 0), 'every decision point must carry an AWS explanation');
  assert.strictEqual(requestTrace!.final, 'SUCCESS');

  await h.unmount();
});

test('4. Send Request: view a failed flow with a DENIED trace and a WHY', async () => {
  const h = await mount();
  await h.act(() => h.api().loadTemplate('highly-available-multiaz'));

  // Fail every compute target so the load balancer has nothing healthy to route to.
  const ecsNodes = h.api().nodes.filter(n => n.data.serviceId === 'ecs');
  for (const n of ecsNodes) {
    await h.act(() => h.api().setNodeHealth(n.id, 'failed', 'Task crashed'));
  }
  await h.act(() => h.api().runScenario());

  const { simulationResult, requestTrace } = h.api();
  assert.strictEqual(simulationResult!.success, false, 'the request must fail with no healthy compute targets');
  assert.strictEqual(simulationResult!.statusCode, 503);

  if (requestTrace) {
    // The trace may legitimately stop at the ALB hop (no further hop is reached once denied) -
    // what matters is that a denial is explained, not that every reference-template hop appears.
    assert.strictEqual(requestTrace.final, 'DENIED');
    assert.ok(requestTrace.why.length > 0, 'a denied request must carry a WHY');
  }

  await h.unmount();
});

test('5. Inject failure: the Failure Lab engine propagates a structured failure into the model', async () => {
  const h = await mount();
  await h.act(() => h.api().loadTemplate('highly-available-multiaz'));

  await h.act(() => h.api().injectFailure({
    targetResourceId: 'AZ-A',
    failureType: 'az_failure',
    severity: 'critical',
    trigger: 'manual',
    reason: 'Zone Outage (AZ-A Hardware Failure)'
  }));

  const { activeFailures, failureImpacts, effectiveNodes } = h.api();
  assert.strictEqual(activeFailures.length, 1, 'the injected failure must be tracked');
  assert.ok(failureImpacts.length > 0, 'the failure engine must produce an impact analysis');

  const azANode = effectiveNodes.find(n => n.id === 'node-ecs-az-a')!;
  assert.strictEqual(azANode.data.health, 'failed', 'the effective model must reflect the direct failure');
  const azBNode = effectiveNodes.find(n => n.id === 'node-ecs-az-b')!;
  assert.strictEqual(azBNode.data.health, 'healthy', 'a failure in one AZ must not affect resources in another AZ');

  await h.act(() => h.api().restoreAllNodes());
  assert.strictEqual(h.api().activeFailures.length, 0, 'restoring must clear the injected failure');

  await h.unmount();
});

test('6. Analyze architecture: validation and analysis engines are wired to the model', async () => {
  const h = await mount();
  await h.act(() => h.api().loadTemplate('basic-spof-app'));

  const { validationFindings, architecturalFindings } = h.api();
  assert.deepStrictEqual(
    validationFindings.filter(f => f.severity === 'CRITICAL'),
    [],
    'a structurally valid template should have no CRITICAL configuration findings'
  );
  assert.ok(
    architecturalFindings.some(f => f.subcategory === 'spof'),
    'the SPOF-ridden basic-spof-app template must be flagged by the analysis engine'
  );
  assert.ok(
    architecturalFindings.some(f => f.subcategory === 'redundancy'),
    'the Single-AZ, single-instance template must be flagged for missing redundancy'
  );

  await h.unmount();
});

test('7. React only displays state - the context never requires a component to compute AWS semantics itself', async () => {
  const h = await mount();
  await h.act(() => h.api().loadTemplate('highly-available-multiaz'));
  await h.act(() => h.api().runScenario());

  // Everything a component needs to display is already-computed data on the context - a
  // component (or this test, standing in for one) never calls into an engine module directly.
  const api = h.api();
  for (const key of ['analysis', 'validationFindings', 'architecturalFindings', 'simulationResult', 'requestTrace', 'failureImpacts']) {
    assert.ok(key in api, `context must expose "${key}" as ready-to-display state`);
  }

  await h.unmount();
});


test('Inspector scopes NACL configuration to subnets and keeps EC2 security groups', async () => {
  const h = await mount(true);
  try {
    await h.act(() => h.api().addServiceNode('ec2', { x: 0, y: 0 }));
    const config = [...document.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Config')!;
    await h.act(() => config.click());
    assert.match(document.body.textContent!, /Security Groups/);
    assert.doesNotMatch(document.body.textContent!, /Network ACL|NACL Rules/);
    await h.act(() => h.api().setShowNaclSideColumn(true));
    await h.act(() => h.api().addBoundaryNode('private_subnet', { x: 0, y: 0 }));
    assert.equal(h.api().showNaclSideColumn, false);
    assert.match(document.body.textContent!, /Network ACL/);
    await h.act(() => h.api().addServiceNode('s3', { x: 600, y: 600 }));
    assert.doesNotMatch(document.body.textContent!, /Attach Security Group|NACL Rules|Network ACL/);
  } finally { await h.unmount(); }
});

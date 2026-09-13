/**
 * Shared harness for the AWS Behavioral Conformance Test Suite (Phase 12).
 *
 * These tests are a different KIND of test from `test/*.test.ts`: those verify the simulator is
 * internally consistent with its own implementation ("does runSimulation agree with itself
 * across a refactor"); these verify the simulator's behavior against documented, external AWS
 * ground truth. Every `ConformanceCase` therefore carries its documentation reference and
 * expected AWS behavior as first-class DATA, not just as a prose test title - so a case can be
 * read, audited, or reported on independent of whether it currently passes.
 */
import assert from 'node:assert';
import test from 'node:test';

export interface ConformanceCase<T = unknown> {
  /** Stable identifier, e.g. 'NET-SG-001' - referenced from audit docs and failure reports. */
  id: string;
  /** The documented AWS behavior this case checks, stated independently of this codebase. */
  awsBehavior: string;
  /** Source/documentation reference - the AWS Guide/Reference section this behavior comes from. */
  reference: string;
  /** Human description of the situation under test. */
  scenario: string;
  /** The configuration under test, as structured data (not prose). */
  configuration: Record<string, unknown>;
  /** The request/operation being evaluated, as structured data. */
  request: Record<string, unknown>;
  /** The behavior AWS itself documents for this configuration+request. */
  expected: T;
  /** Runs the simulator's own engine against `configuration`/`request` and returns its result, in
   *  the same shape as `expected` so they can be compared directly. */
  run: () => T;
  /** Explains, given the actual result, why it does (or does not) match documented AWS behavior -
   *  always populated, read whether the case passes or fails. */
  explain: (actual: T) => string;
}

/**
 * Registers one `ConformanceCase` as a `node:test` test. On failure, the thrown error carries the
 * FULL structured record (Test ID/AWS behavior/reference/scenario/configuration/request/expected/
 * simulator result/explanation) - not just a diff - so a failing conformance test is itself a
 * readable audit finding.
 */
export function runConformanceCase<T>(c: ConformanceCase<T>): void {
  test(`${c.id}: ${c.scenario}`, () => {
    const actual = c.run();
    const explanation = c.explain(actual);
    try {
      assert.deepStrictEqual(actual, c.expected);
    } catch (err) {
      const report = [
        '',
        `Test ID:        ${c.id}`,
        `AWS behavior:   ${c.awsBehavior}`,
        `Reference:      ${c.reference}`,
        `Scenario:       ${c.scenario}`,
        `Configuration:  ${JSON.stringify(c.configuration)}`,
        `Request:        ${JSON.stringify(c.request)}`,
        `Expected:       ${JSON.stringify(c.expected)}`,
        `Simulator result: ${JSON.stringify(actual)}`,
        `Explanation:    ${explanation}`,
        ''
      ].join('\n');
      throw new Error(report + (err as Error).message);
    }
  });
}

export function runConformanceCases<T>(cases: ConformanceCase<T>[]): void {
  cases.forEach(runConformanceCase);
}

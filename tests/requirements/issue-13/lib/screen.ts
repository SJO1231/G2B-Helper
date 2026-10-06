// #13 화면 검사 공통 도구. 기존 tests/mvp/bridge.test.ts와 같은 방식으로 기존 개발 Chromium을 격리 컨텍스트로 띄우고,
// 127.0.0.1 합성 주소에 HTML을 응답해 외부 통신 없이 연다. 실제 프로필·확장·업무 자료를 쓰지 않는다.
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { MET, UNMET, UNVERIFIED, diffValues, judgeRowMultiset, type Judgment } from './judge';
import type { Cause } from './outcome';

export const SCREEN_ORIGIN = 'http://127.0.0.1:47913/';

export async function launchBrowser(): Promise<Browser> {
  const executablePath = [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  if (!executablePath) throw new Error('Existing development Chromium/Chrome/Edge is required for #13 screen checks.');
  return chromium.launch({ executablePath, headless: true });
}

/** HTML 하나를 합성 주소로 응답하고, 그 밖의 요청은 모두 막는다. */
export async function openHtml(browser: Browser, html: string, path = 'page.html'): Promise<{ context: BrowserContext; page: Page; blocked: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const blocked: string[] = [];
  await context.route((url) => !url.href.startsWith(SCREEN_ORIGIN), (route) => { blocked.push(route.request().url()); return route.abort(); });
  await context.route(SCREEN_ORIGIN + '**', (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
  const page = await context.newPage();
  page.setDefaultTimeout(3000);
  await page.goto(SCREEN_ORIGIN + path);
  return { context, page, blocked };
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export interface InjectionResult { html: string; markerFound: boolean; beforeSha256: string; afterSha256: string; }

/** /*M:name*\/ … /*\/M:name*\/ 표식 블록 하나의 내용만 바꾼다. 표식이 정확히 1쌍이 아니면 주입하지 않는다. */
export function injectBlock(html: string, name: string, replace: (original: string) => string): InjectionResult {
  const open = `/*M:${name}*/`;
  const close = `/*/M:${name}*/`;
  const beforeSha256 = sha256(html);
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  const single = start >= 0 && end > start && html.indexOf(open, start + 1) < 0 && html.indexOf(close, end + 1) < 0;
  if (!single) return { html, markerFound: false, beforeSha256, afterSha256: beforeSha256 };
  const original = html.slice(start + open.length, end);
  const next = html.slice(0, start + open.length) + replace(original) + html.slice(end);
  return { html: next, markerFound: true, beforeSha256, afterSha256: sha256(next) };
}

/** 화면 판정 하나. 원인 목록은 판정 함수가 찾은 차이를 모두 담는다. */
export interface ScreenJudgment {
  verdict: string;
  causes: Cause[];
  observed: boolean;
  targets: number;
  outputComplete: boolean;
  witness: boolean;
  detail?: unknown;
}

export function notObserved(reason: string): ScreenJudgment {
  return { verdict: `${UNVERIFIED}(관측 불가)`, causes: [], observed: false, targets: 0, outputComplete: false, witness: true, detail: reason };
}

export function fromRows(judgment: Judgment, targets: number): ScreenJudgment {
  if (judgment.verdict !== MET && judgment.verdict !== UNMET) return { verdict: judgment.verdict, causes: [], observed: true, targets, outputComplete: true, witness: true, detail: judgment.reason };
  const causes: Cause[] = [
    ...(judgment.missing ?? []).map((id) => ({ element: `row:${id}`, value: 'missing' })),
    ...(judgment.extra ?? []).map((id) => ({ element: `row:${id}`, value: 'extra' })),
  ];
  return { verdict: judgment.verdict, causes, observed: true, targets, outputComplete: true, witness: true, detail: judgment.observed };
}

export function rowsJudgment(expected: readonly string[], actual: readonly string[] | undefined, targets: number): ScreenJudgment {
  if (!actual) return notObserved('표시 행을 읽지 못함');
  return fromRows(judgeRowMultiset(expected, actual), targets);
}

/** 저장소별 기대값과 실제값의 보존 판정. 원인은 `저장소$경로`와 차이 종류다. */
export function preservationJudgment(pairs: { store: string; expected: unknown; actual: unknown }[]): ScreenJudgment {
  if (pairs.some((pair) => pair.actual === undefined)) return notObserved('저장소를 읽지 못함');
  const causes = pairs.flatMap((pair) => diffValues(pair.expected, pair.actual).map((difference) => ({ element: `${pair.store}${difference.path}`, value: difference.kind })));
  const targets = pairs.reduce((sum, pair) => sum + (Array.isArray(pair.expected) ? pair.expected.length : typeof pair.expected === 'object' && pair.expected ? Object.keys(pair.expected).length : 1), 0);
  return { verdict: causes.length ? UNMET : MET, causes, observed: true, targets, outputComplete: true, witness: true };
}

/** 단계 하나를 실행하고, 실패하면 통과가 아니라 관측 불가로 남기도록 undefined를 돌려준다. */
export async function step<T>(errors: string[], label: string, action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    return undefined;
  }
}

/** 표시 행 식별자(tbody tr의 data-row)를 화면 순서대로 읽는다. */
export const displayIds = (page: Page, rowSelector: string): Promise<string[]> =>
  page.locator(rowSelector).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row') ?? ''));

// #13 화면 검사 공통 도구. 기존 개발 Chromium을 새 격리 컨텍스트로 띄우고,
// 127.0.0.1 합성 주소에 HTML을 응답한다. 실제 프로필·확장·업무 자료를 쓰지 않는다.
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { MET, UNMET, UNVERIFIED, diffValues, judgeRowMultiset, type Judgment } from './judge';
import type { Cause, InjectionEvidence } from './outcome';

export const SCREEN_ORIGIN = 'http://127.0.0.1:47913/';

export async function launchBrowser(): Promise<Browser> {
  const executablePath = [chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
  if (!executablePath) throw new Error('기존 개발 Chromium/Chrome/Edge가 있어야 #13 화면 검사를 실행할 수 있습니다.');
  return chromium.launch({ executablePath, headless: true });
}

/** HTML 하나를 합성 주소로 응답하고, 그 밖의 요청은 모두 막는다. 준비 실패에도 컨텍스트를 닫는다. */
export async function openHtml(browser: Browser, html: string, path = 'page.html'): Promise<{ context: BrowserContext; page: Page; blocked: string[]; errors: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
  const blocked: string[] = [];
  const errors: string[] = [];
  try {
    const address = SCREEN_ORIGIN + path;
    await context.route('**/*', (route) => {
      if (route.request().url() === address && route.request().resourceType() === 'document') {
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
      }
      blocked.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.setDefaultTimeout(3000);
    await page.goto(address);
    return { context, page, blocked, errors };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
export interface InjectionResult extends InjectionEvidence { html: string; }

/** /*M:name*\/ … /*\/M:name*\/ 표식이 정확히 1쌍인 블록만 바꾼다. */
export function injectBlock(html: string, name: string, replace: (original: string) => string): InjectionResult {
  const open = `/*M:${name}*/`;
  const close = `/*/M:${name}*/`;
  const beforeSha256 = sha256(html);
  const start = html.indexOf(open);
  const end = html.indexOf(close);
  const single = start >= 0 && end > start && html.indexOf(open, start + 1) < 0 && html.indexOf(close, end + 1) < 0;
  if (!single) return { html, markerFound: false, beforeSha256, afterSha256: beforeSha256 };
  const original = html.slice(start + open.length, end);
  const replacement = replace(original);
  if (replacement.includes(open) || replacement.includes(close)) return { html, markerFound: false, beforeSha256, afterSha256: beforeSha256 };
  const next = html.slice(0, start + open.length) + replacement + html.slice(end);
  return { html: next, markerFound: true, beforeSha256, afterSha256: sha256(next), blockDiff: { marker: name, before: original, after: replacement } };
}

/** targets는 실제 읽은 영역 수다. 제거된 버튼 수나 표시 행 수가 아니다. */
export interface ScreenJudgment {
  verdict: string;
  causes: Cause[];
  observed: boolean;
  targets: number;
  outputComplete: boolean;
  witness: boolean;
  searchRows?: string[];
  detail?: unknown;
}

export function notObserved(reason: string): ScreenJudgment {
  return { verdict: `${UNVERIFIED}(관측 불가)`, causes: [], observed: false, targets: 0, outputComplete: false, witness: true, detail: reason };
}

export function fromRows(judgment: Judgment, targets: number): ScreenJudgment {
  if (judgment.verdict !== MET && judgment.verdict !== UNMET) return { verdict: `${judgment.verdict}(${judgment.reason})`, causes: [], observed: true, targets, outputComplete: true, witness: true, detail: judgment.reason };
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
  return { verdict: causes.length ? UNMET : MET, causes, observed: true, targets: pairs.length, outputComplete: true, witness: true };
}

export async function step<T>(errors: string[], label: string, action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    errors.push(`${label}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    return undefined;
  }
}

/** tbody의 존재를 먼저 읽는다. 빈 검색은 [], 영역 부재는 관측 실패다. */
export const displayIds = async (page: Page, rowSelector: string): Promise<string[]> => {
  const regionSelector = rowSelector.replace(/\s+tr$/, '');
  const region = page.locator(regionSelector);
  const table = page.locator('table').filter({ has: region });
  if (await region.count() !== 1 || await table.count() !== 1 || !await table.isVisible()) throw new Error('표시 행 영역을 관측하지 못함');
  return page.locator(rowSelector).evaluateAll((rows) => rows.map((row) => row.getAttribute('data-row') ?? ''));
};

#!/usr/bin/env node
/**
 * memory.md 与代码事实一致性检查（防"声明型段落过期"——速查表记了但 §1/头部没改的偏差模式）。
 * 断言五项：Electron 主版本 / 速查表最新行≥package version / Pi pin / Fundet job 已删 / 设置 Tab 清单。
 * CI（ci.yml）push/PR 跑；FAIL 退出 1 并列出偏差位置。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

const memory = read('memory.md');
const pkg = JSON.parse(read('apps/desktop/package.json'));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail: ok ? '' : detail });

// 1) §1 声明的 Electron 主版本 === package.json electron 依赖主版本
{
  const dep = pkg.devDependencies.electron ?? '';
  const m = /^\^?(\d+)\./.exec(dep);
  const declared = /^- Electron (\d+)/m.exec(memory);
  if (!m) check('electron 依赖可解析', false, `package.json electron="${dep}" 无法解析主版本`);
  else if (!declared) check('§1 Electron 版本声明', false, 'memory.md §1 找不到 "- Electron NN" 列表项（声明行缺失）');
  else check('§1 Electron 版本', Number(declared[1]) === Number(m[1]),
    `§1 声明 Electron ${declared[1]}，package.json 实为 ${m[1]}（改依赖必须同步 §1）`);
}

// 2) 速查表最新数据行版本 ≥ package.json version（bump 后必须先记速查表）
{
  const row = /^\| (0\.\d+\.\d+) \|/m.exec(memory);
  const ver = pkg.version;
  if (!row) check('速查表版本行', false, 'memory.md 版本速查表找不到数据行');
  else {
    const [a1, b1, c1] = row[1].split('.').map(Number);
    const [a2, b2, c2] = ver.split('.').map(Number);
    const tableNewer = a1 > a2 || (a1 === a2 && (b1 > b2 || (b1 === b2 && c1 >= c2)));
    check('速查表最新行 ≥ package version', tableNewer,
      `速查表最新行 ${row[1]} 落后于 package.json ${ver}——bump 版本必须同步速查表`);
  }
}

// 3) §5 Pi pin === tools/pi/latest.json
{
  const pin = JSON.parse(read('tools/pi/latest.json')).version;
  const declared = /Pi pin[^\n]*?→ \*\*(\d+\.\d+\.\d+)\*\*/.exec(memory);
  if (!declared) check('§5 Pi pin 声明', false, 'memory.md 找不到 "Pi pin：...→ **X.Y.Z**" 行');
  else check('§5 Pi pin', declared[1] === String(pin),
    `§5 声明 ${declared[1]}，latest.json 实为 ${pin}（升级 pi 必须同步 §5）`);
}

// 4) release.yml 不得再出 Fundet 发版 job（BRAND=fundet 已删；fundet-desktop 包名是历史名不算）
{
  const wf = read('.github/workflows/release.yml');
  check('release.yml 无 Fundet 发版 job', !/BRAND=fundet/.test(wf) && !/dist:win:fundet/.test(wf) && !/dist:mac:fundet/.test(wf),
    'release.yml 重新出现 fundet 发版 job——若恢复双品牌发版，须同步 memory.md 头部声明与硬约束第 0 条');
}

// 5) §1 设置 Tab 清单覆盖 SettingsPage 全部 tab
{
  const page = read('apps/desktop/src/renderer/src/pages/SettingsPage.tsx');
  const labels = [...page.matchAll(/:\s*'([^']+)',/g)].map((m) => m[1]);
  const tabBlock = /const TAB_LABELS[\s\S]*?\};/.exec(page)?.[0] ?? '';
  const tabs = [...tabBlock.matchAll(/:\s*'([^']+)',/g)].map((m) => m[1]);
  const row = /^\| 设置 Tab \|(.*)$/m.exec(memory);
  if (tabs.length === 0) check('TAB_LABELS 可解析', false, 'SettingsPage.tsx TAB_LABELS 提取为空');
  else if (!row) check('§1 设置 Tab 行', false, 'memory.md 找不到 "| 设置 Tab |" 行');
  else {
    const missing = tabs.filter((t) => !row[1].includes(t));
    check('§1 设置 Tab 清单完整', missing.length === 0,
      `§1 设置 Tab 行缺少：${missing.join('、')}（新增 tab 必须同步 §1）`);
  }
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.ok ? '' : ' —— ' + r.detail}`);
}
if (failed.length > 0) {
  console.log(`\nMEMORY-SYNC-FAIL(${failed.length})：memory.md 声明与代码事实脱节，按硬约束第 10 条同步后再推。`);
  process.exit(1);
}
console.log('\nMEMORY-SYNC-PASS');

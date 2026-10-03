import { claimCard, mergeCard, buildInitialBatches, AIRCRAFT, type OfflineCard, type StageSignature, type IncomingCard } from './src/transfer';
import { store, applyReception, supplementConflict } from './src/store';

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); }
  else { fail += 1; console.log(`  ✗ ${name}`); }
}

const baseCards: OfflineCard[] = [
  { id: 'CARD-01', title: 't', estimated: 1, zone: 'z', dependencies: [], tolerance: 'tol', evidence: 'ev', witness: 'w', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署', evidenceFiles: [] },
  { id: 'CARD-02', title: 't', estimated: 1, zone: 'z', dependencies: [], tolerance: 'tol', evidence: 'ev', witness: 'w', status: '执行中', measurement: '', finding: '', stage: '发动机签署', evidenceFiles: [] },
  { id: 'CARD-03', title: 't', estimated: 1, zone: 'z', dependencies: [], tolerance: 'tol', evidence: 'ev', witness: 'w', status: '待授权', measurement: '2762 psi', finding: '低于容差', stage: '系统签署', evidenceFiles: [] }
];
const baseSigs: StageSignature[] = [
  { stage: '机械', status: '已签署', actor: '赵明', time: '09:18' },
  { stage: '系统', status: '待签署', actor: '待指定', time: '-' },
  { stage: '放行', status: '待签署', actor: '质量经理', time: '-' }
];

console.log('认领规则（工卡编号 + 飞机登记号）');
{
  const wrongAc: IncomingCard = { id: 'CARD-01', aircraft: 'B-1234', status: '已完成', measurement: '1.62', finding: '', evidenceFiles: [], stage: '机械签署', signature: null };
  const r1 = claimCard(baseCards, wrongAc, AIRCRAFT);
  check('登记号不一致 → 拒绝认领', r1.status === 'rejected');

  const unknown: IncomingCard = { id: 'CARD-99', aircraft: AIRCRAFT, status: '执行中', measurement: 'x', finding: '', evidenceFiles: [], stage: '机械签署', signature: null };
  const r2 = claimCard(baseCards, unknown, AIRCRAFT);
  check('工卡不在本包 → 拒绝认领', r2.status === 'rejected');

  const ok: IncomingCard = { id: 'CARD-02', aircraft: AIRCRAFT, status: '执行中', measurement: '叶片完好', finding: '正常', evidenceFiles: ['a.jpg'], stage: '发动机签署', signature: { stage: '发动机', status: '已签署', actor: '孙琪', time: '10:00' } };
  const r3 = claimCard(baseCards, ok, AIRCRAFT);
  check('工卡+登记号匹配 → 认领', r3.status === 'claimed');
}

console.log('无冲突并入');
{
  const incoming: IncomingCard = { id: 'CARD-02', aircraft: AIRCRAFT, status: '执行中', measurement: '叶片完好，无凹坑', finding: '孔探未见异常', evidenceFiles: ['a.jpg', 'b.jpg'], stage: '发动机签署', signature: { stage: '发动机', status: '已签署', actor: '孙琪', time: '10:05' } };
  const out = mergeCard(baseCards, baseSigs, incoming, AIRCRAFT, false);
  check('并入成功', out.merged === true);
  check('测量并入（本站为空）', out.change?.measurement === '叶片完好，无凹坑');
  check('发现并入', out.change?.finding === '孔探未见异常');
  check('证据并入 2 份', (out.change?.evidenceFiles?.length ?? 0) === 2);
  check('阶段签署并入（本站待签署）', out.signatureMerge?.stage === '发动机');
  check('无冲突', out.conflict === null);
}

console.log('测量冲突 → 挂起并保留两份原值');
{
  const incoming: IncomingCard = { id: 'CARD-03', aircraft: AIRCRAFT, status: '待授权', measurement: '2810 psi', finding: '外站复测正常', evidenceFiles: ['x.pdf'], stage: '系统签署', signature: null };
  const out = mergeCard(baseCards, baseSigs, incoming, AIRCRAFT, false);
  check('不并入', out.merged === false);
  check('挂起冲突', out.conflict?.status === '挂起');
  check('保留本站原值', out.conflict?.localValue === '2762 psi');
  check('保留外站原值', out.conflict?.incomingValue === '2810 psi');
  check('不推进状态', out.change === null);
  check('不并入签署', out.signatureMerge === null);
}

console.log('旧包无来源标记 → 本站历史兼容');
{
  const incoming: IncomingCard = { id: 'CARD-01', aircraft: AIRCRAFT, status: '已完成', measurement: '1.60 mm', finding: '正常', evidenceFiles: ['old.mp4'], stage: '机械签署', signature: null };
  const out = mergeCard(baseCards, baseSigs, incoming, AIRCRAFT, true);
  check('兼容模式不挂起', out.conflict === null);
  check('测量差异以本站历史为准（不覆盖）', out.change?.measurement === undefined);
  check('证据仍并入', (out.change?.evidenceFiles?.length ?? 0) === 1);
}

console.log('幂等：同一批次号只成一次');
{
  const batches = buildInitialBatches();
  const dup = batches.filter((b) => b.batchNo === 'PEK-T3-20260929-07');
  check('存在同批次号的两座机库提交', dup.length === 2 && dup[0].sourceHangar !== dup[1].sourceHangar);
}

console.log('store：接收合并 + 补交失效重算');
{
  const before = store.getState().maintenance;
  check('初始有 3 个待接收批次', before.transferBatches.filter((b) => b.status === '待接收').length === 3);

  // 模拟首批次接收（前 2 项并入后失败）
  const batch = before.transferBatches[0];
  const partial = {
    batchNo: batch.batchNo, legacy: false, duplicate: false,
    changes: [
      { cardId: 'CARD-01', evidenceFiles: ['右主起落架收放测试_北京T3.mp4'] },
      { cardId: 'CARD-02', measurement: '叶片完好，无凹坑', finding: '孔探未见异常', evidenceFiles: ['a.jpg', 'b.jpg'] }
    ],
    conflicts: [], rejected: [], signatureMerges: [{ stage: '发动机', status: '已签署' as const, actor: '孙琪', time: '10:05' }],
    evidenceAdded: 3, statusAdvanced: 0
  };
  store.dispatch(applyReception({ outcome: partial, commit: false }));
  let s = store.getState().maintenance;
  const b = s.transferBatches.find((x) => x.batchNo === batch.batchNo)!;
  check('写入失败 → 批次状态 写入失败', b.status === '写入失败');
  check('已并入 2 项（回到接站前流程，数据保留）', b.mergedCardIds.length === 2);
  check('重试只补尚未并入：mergedCardIds 含前 2 项', b.mergedCardIds.includes('CARD-01') && b.mergedCardIds.includes('CARD-02'));

  // 重试：只补剩余工卡
  const retry = {
    batchNo: batch.batchNo, legacy: false, duplicate: false,
    changes: [
      { cardId: 'CARD-06', evidenceFiles: ['应急设备清单.pdf'] },
      { cardId: 'CARD-04', evidenceFiles: ['时寿件.jpg'] },
      { cardId: 'CARD-05', measurement: 'AD 已执行', finding: '正常', evidenceFiles: ['AD.pdf'], status: '已完成' as const },
      { cardId: 'CARD-07', measurement: '试车正常', finding: '正常', evidenceFiles: ['APU.csv'] }
    ],
    conflicts: [
      { cardId: 'CARD-03', field: 'measurement' as const, localValue: '2762 psi', incomingValue: '2810 psi', status: '挂起' as const },
      { cardId: 'CARD-08', field: 'measurement' as const, localValue: '发现 2 次压力偏低', incomingValue: '压力正常', status: '挂起' as const }
    ],
    rejected: [{ cardId: 'CARD-99', reason: '登记号不一致' }],
    signatureMerges: [{ stage: '动力', status: '已签署' as const, actor: '吴凯', time: '14:10' }],
    evidenceAdded: 4, statusAdvanced: 1
  };
  store.dispatch(applyReception({ outcome: retry, commit: true }));
  s = store.getState().maintenance;
  const b2 = s.transferBatches.find((x) => x.batchNo === batch.batchNo)!;
  check('重试后批次 已接收', b2.status === '已接收');
  check('processedBatchNos 含批次号（幂等）', s.processedBatchNos.includes(batch.batchNo));
  check('完成数按合并后包计算（不重复）：CARD-05 已完成', s.cards.find((c) => c.id === 'CARD-05')?.status === '已完成');
  check('冲突挂起 2 项', s.conflicts.filter((c) => c.status === '挂起').length === 2);
  check('放行结论失效（released=false）', s.released === false);

  // 补交 CARD-03
  store.dispatch(supplementConflict({ cardId: 'CARD-03', measurement: '2860 psi', evidenceFiles: ['压力复测报告.pdf'] }));
  s = store.getState().maintenance;
  const c3 = s.cards.find((c) => c.id === 'CARD-03')!;
  check('补交后测量更新', c3.measurement === '2860 psi');
  check('补交后状态回到执行中', c3.status === '执行中');
  const sys = s.signatures.find((sig) => sig.stage === '系统')!;
  check('相关阶段签字立即失效（系统 → 待签署）', sys.status === '待签署');
  check('放行结论立即失效', s.released === false);
  check('冲突标记已补交', s.conflicts.find((c) => c.cardId === 'CARD-03')?.status === '已补交');
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);

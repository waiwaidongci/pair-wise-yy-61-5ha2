// 转站接收合并引擎：按工卡编号 + 飞机登记号认领外站工卡，
// 无冲突的测量 / 证据 / 阶段签署并入当前包，冲突挂起并保留两份原值。

export type EvidenceFile = string;

export type OfflineCardStatus = '未开始' | '执行中' | '待授权' | '已完成';

export type OfflineCard = {
  id: string;
  title: string;
  estimated: number;
  zone: string;
  dependencies: string[];
  tolerance: string;
  evidence: string;
  witness: string;
  status: OfflineCardStatus;
  measurement: string;
  finding: string;
  stage: string;
  evidenceFiles?: EvidenceFile[];
};

export type StageSignature = { stage: string; status: '待签署' | '已签署'; actor: string; time: string };

export type IncomingSignature = { stage: string; status: '已签署'; actor: string; time: string };

export type IncomingCard = {
  id: string;
  aircraft: string;
  status: OfflineCardStatus;
  measurement: string;
  finding: string;
  evidenceFiles: EvidenceFile[];
  stage: string;
  signature: IncomingSignature | null;
};

export type MergeConflict = {
  cardId: string;
  field: 'measurement';
  localValue: string;
  incomingValue: string;
  status: '挂起' | '已补交';
  resolvedValue?: string;
  resolvedEvidence?: EvidenceFile[];
};

export type CardChange = {
  cardId: string;
  measurement?: string;
  finding?: string;
  evidenceFiles?: EvidenceFile[];
  status?: OfflineCardStatus;
};

export type CardMergeOutcome = {
  cardId: string;
  merged: boolean;
  conflict: MergeConflict | null;
  change: CardChange | null;
  signatureMerge: IncomingSignature | null;
  evidenceAdded: number;
  statusAdvanced: boolean;
  rejected: string | null;
};

export type ReceptionOutcome = {
  batchNo: string;
  legacy: boolean;
  duplicate: boolean;
  changes: CardChange[];
  conflicts: MergeConflict[];
  rejected: { cardId: string; reason: string }[];
  signatureMerges: IncomingSignature[];
  evidenceAdded: number;
  statusAdvanced: number;
};

export type TransferBatch = {
  batchNo: string;
  sourceHangar: string;
  aircraft: string;
  packageId: string;
  receivedAt: string;
  status: '待接收' | '写入失败' | '已接收';
  transientFailure: boolean;
  attempts: number;
  cards: IncomingCard[];
  mergedCardIds: string[];
  conflictCardIds: string[];
  rejectedCardIds: string[];
};

export const AIRCRAFT = 'B-7891';

const STATUS_ORDER: Record<OfflineCardStatus, number> = {
  未开始: 0,
  执行中: 1,
  待授权: 2,
  已完成: 3
};

// 按工卡编号 + 飞机登记号认领；登记号不一致或工卡不在本包则拒绝认领。
export function claimCard(
  localCards: OfflineCard[],
  incoming: IncomingCard,
  aircraft: string
): { status: 'claimed'; card: OfflineCard } | { status: 'rejected'; reason: string } {
  if (incoming.aircraft !== aircraft) {
    return { status: 'rejected', reason: `飞机登记号 ${incoming.aircraft} 与本机 ${aircraft} 不一致，不予认领` };
  }
  const card = localCards.find((item) => item.id === incoming.id);
  if (!card) {
    return { status: 'rejected', reason: `工卡 ${incoming.id} 不在当前工作包，无法认领` };
  }
  return { status: 'claimed', card };
}

function signatureStagePrefix(cardStage: string): string {
  return cardStage.replace(/签署$/, '');
}

// 只读地查找与工卡阶段对应的签署记录；不存在时返回 undefined（并入时再创建）。
export function findSignatureForStage(signatures: StageSignature[], cardStage: string): StageSignature | undefined {
  const prefix = signatureStagePrefix(cardStage);
  return signatures.find((item) => item.stage === prefix || cardStage.startsWith(item.stage));
}

// 纯函数：计算一张外站工卡的并入结果，不修改传入数据。
export function mergeCard(
  localCards: OfflineCard[],
  signatures: StageSignature[],
  incoming: IncomingCard,
  aircraft: string,
  legacy: boolean
): CardMergeOutcome {
  const claim = claimCard(localCards, incoming, aircraft);
  if (claim.status === 'rejected') {
    return { cardId: incoming.id, merged: false, conflict: null, change: null, signatureMerge: null, evidenceAdded: 0, statusAdvanced: false, rejected: claim.reason };
  }
  const card = claim.card;

  const measurementConflict =
    incoming.measurement.trim() !== '' &&
    card.measurement.trim() !== '' &&
    incoming.measurement.trim() !== card.measurement.trim();

  // 两套测量不一致：挂起并保留两份原值，不并入测量、不推进状态、不并入阶段签署。
  if (measurementConflict && !legacy) {
    return {
      cardId: card.id,
      merged: false,
      conflict: { cardId: card.id, field: 'measurement', localValue: card.measurement, incomingValue: incoming.measurement, status: '挂起' },
      change: null,
      signatureMerge: null,
      evidenceAdded: 0,
      statusAdvanced: false,
      rejected: null
    };
  }

  const change: CardChange = { cardId: card.id };
  let hasChange = false;

  // 证据按并集并入（可累加），只新增本站没有的附件。
  const localEvidence = card.evidenceFiles ?? [];
  const mergedEvidence = [...localEvidence];
  let evidenceAdded = 0;
  for (const file of incoming.evidenceFiles) {
    if (!mergedEvidence.includes(file)) {
      mergedEvidence.push(file);
      evidenceAdded += 1;
    }
  }
  if (evidenceAdded > 0) {
    change.evidenceFiles = mergedEvidence;
    hasChange = true;
  }

  // 测量：本站为空则并入；旧包按本站历史兼容，测量差异以本站历史为准（不覆盖）。
  if (incoming.measurement.trim() !== '' && card.measurement.trim() === '') {
    change.measurement = incoming.measurement;
    hasChange = true;
  }

  // 发现与处置：本站为空则并入。
  if (incoming.finding.trim() !== '' && card.finding.trim() === '') {
    change.finding = incoming.finding;
    hasChange = true;
  }

  // 状态只向前推进，不回退。
  let statusAdvanced = false;
  if (STATUS_ORDER[incoming.status] > STATUS_ORDER[card.status]) {
    change.status = incoming.status;
    hasChange = true;
    statusAdvanced = true;
  }

  // 阶段签署：仅当本站对应阶段尚未签署时并入，避免重复签署。
  let signatureMerge: IncomingSignature | null = null;
  if (incoming.signature && incoming.signature.status === '已签署') {
    const localSignature = findSignatureForStage(signatures, card.stage);
    if (!localSignature || localSignature.status === '待签署') {
      signatureMerge = {
        stage: localSignature?.stage ?? signatureStagePrefix(card.stage),
        status: '已签署',
        actor: incoming.signature.actor,
        time: incoming.signature.time
      };
    }
  }

  return {
    cardId: card.id,
    merged: true,
    conflict: null,
    change: hasChange ? change : null,
    signatureMerge,
    evidenceAdded,
    statusAdvanced,
    rejected: null
  };
}

// 模拟外站转入的合并批次数据。
export function buildInitialBatches(): TransferBatch[] {
  return [
    {
      batchNo: 'PEK-T3-20260929-07',
      sourceHangar: '北京首都 · T3 机库',
      aircraft: AIRCRAFT,
      packageId: 'WP-B7891-04',
      receivedAt: '2026-09-29 15:40',
      status: '待接收',
      transientFailure: true,
      attempts: 0,
      mergedCardIds: [],
      conflictCardIds: [],
      rejectedCardIds: [],
      cards: [
        { id: 'CARD-01', aircraft: AIRCRAFT, status: '已完成', measurement: '1.62 mm', finding: '正常', evidenceFiles: ['右主起落架收放测试_北京T3.mp4'], stage: '机械签署', signature: { stage: '机械', status: '已签署', actor: '赵磊 · 机械师', time: '09-29 08:20' } },
        { id: 'CARD-02', aircraft: AIRCRAFT, status: '执行中', measurement: '叶片完好，无凹坑', finding: '孔探未见异常', evidenceFiles: ['发动机孔探_北京T3_01.jpg', '发动机孔探_北京T3_02.jpg'], stage: '发动机签署', signature: { stage: '发动机', status: '已签署', actor: '孙琪 · 发动机工程师', time: '09-29 10:05' } },
        { id: 'CARD-06', aircraft: AIRCRAFT, status: '未开始', measurement: '', finding: '', evidenceFiles: ['应急设备清单_北京T3.pdf', '灭火器检查记录_北京T3.jpg'], stage: '客舱签署', signature: null },
        { id: 'CARD-03', aircraft: AIRCRAFT, status: '待授权', measurement: '2810 psi', finding: '北京T3 复测 2810 psi，系统 A 压力恢复', evidenceFiles: ['压力复测记录_北京T3.pdf'], stage: '系统签署', signature: null },
        { id: 'CARD-04', aircraft: AIRCRAFT, status: '已完成', measurement: '剩余 836 循环', finding: '正常', evidenceFiles: ['时寿件核对_北京T3.jpg'], stage: '适航签署', signature: { stage: '适航', status: '已签署', actor: '周婷 · 检验员', time: '09-29 09:40' } },
        { id: 'CARD-05', aircraft: AIRCRAFT, status: '已完成', measurement: 'AD 2024-15-03 已按标准施工', finding: '正常', evidenceFiles: ['AD执行记录_北京T3.pdf'], stage: '适航签署', signature: { stage: '适航', status: '已签署', actor: '周婷 · 检验员', time: '09-29 11:20' } },
        { id: 'CARD-07', aircraft: AIRCRAFT, status: '未开始', measurement: '试车参数正常', finding: 'APU 启动时间 18s，参数在 AMM 范围', evidenceFiles: ['APU试车数据_北京T3.csv', '油样报告_北京T3.pdf'], stage: '动力签署', signature: { stage: '动力', status: '已签署', actor: '吴凯 · 动力工程师', time: '09-29 14:10' } },
        { id: 'CARD-08', aircraft: AIRCRAFT, status: '执行中', measurement: '压力正常，无新增重复缺陷', finding: '北京T3 复测系统压力正常，重复缺陷未新增', evidenceFiles: ['重复缺陷复核_北京T3.pdf'], stage: '放行签署', signature: { stage: '放行', status: '已签署', actor: '质量经理', time: '09-29 15:00' } },
        { id: 'CARD-99', aircraft: 'B-1234', status: '执行中', measurement: '无关飞机数据', finding: '', evidenceFiles: [], stage: '机械签署', signature: null }
      ]
    },
    {
      batchNo: 'YY61-HISTORY-0928',
      sourceHangar: '',
      aircraft: AIRCRAFT,
      packageId: 'WP-B7891-04',
      receivedAt: '2026-09-28 17:10',
      status: '待接收',
      transientFailure: false,
      attempts: 0,
      mergedCardIds: [],
      conflictCardIds: [],
      rejectedCardIds: [],
      cards: [
        { id: 'CARD-01', aircraft: AIRCRAFT, status: '已完成', measurement: '1.60 mm', finding: '正常', evidenceFiles: ['右主起落架收放测试_本站历史.mp4'], stage: '机械签署', signature: null },
        { id: 'CARD-06', aircraft: AIRCRAFT, status: '未开始', measurement: '应急设备检查完成，全部在有效期内', finding: '正常', evidenceFiles: ['客舱应急设备_本站历史.jpg'], stage: '客舱签署', signature: { stage: '客舱', status: '已签署', actor: '本站历史 · 客舱检验', time: '09-28 16:00' } },
        { id: 'CARD-07', aircraft: AIRCRAFT, status: '未开始', measurement: '试车完成，参数正常', finding: 'APU 启动时间 19s', evidenceFiles: ['APU试车_本站历史.csv'], stage: '动力签署', signature: null }
      ]
    },
    {
      batchNo: 'PEK-T3-20260929-07',
      sourceHangar: '北京首都 · T2 机库',
      aircraft: AIRCRAFT,
      packageId: 'WP-B7891-04',
      receivedAt: '2026-09-29 15:42',
      status: '待接收',
      transientFailure: false,
      attempts: 0,
      mergedCardIds: [],
      conflictCardIds: [],
      rejectedCardIds: [],
      cards: [
        { id: 'CARD-01', aircraft: AIRCRAFT, status: '已完成', measurement: '1.62 mm', finding: '正常', evidenceFiles: [], stage: '机械签署', signature: null }
      ]
    }
  ];
}

import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { maintenanceApi } from './api';
import {
  TARGET_AIRCRAFT,
  deriveMergedCards,
  hangarLabel,
  stageKeyOf,
  statusRank,
  type CardRecord,
  type EvidenceFile,
  type FieldConflict,
  type ReleaseNote,
  type SignatureValue,
  type TransferResult
} from './transfer';

export type CardStatus = '未开始' | '执行中' | '待授权' | '已完成' | '挂起';

export type StageSignature = {
  stage: string;
  status: '待签署' | '已签署';
  actor: string;
  time: string;
  // 测量或证据补交后立即失效，需重算重签
  invalidated?: boolean;
  invalidatedReason?: string;
};

export type CardConflict = {
  conflicts: FieldConflict[];
  sources: string[];
  suspendedAt: string;
};

export type OfflineCard = {
  id: string;
  title: string;
  estimated: number;
  zone: string;
  dependencies: string[];
  tolerance: string;
  evidence: string;
  witness: string;
  status: CardStatus;
  measurement: string;
  finding: string;
  stage: string;
  aircraft: string;
  evidenceFiles: EvidenceFile[];
  // 并入该工卡的来源机库
  sourceHangars: string[];
  legacy?: boolean;
  releaseNote?: ReleaseNote;
  conflict?: CardConflict;
};

export type AppliedBatch = {
  batchId: string;
  attempts: number;
  coalesced: boolean;
  mergedCardIds: string[];
  unclaimed: { cardId: string; aircraft: string }[];
  committedRecords: CardRecord[];
  time: string;
};

type MaintenanceState = {
  cards: OfflineCard[];
  activeCardId: string;
  syncVersion: number;
  serverVersion: number;
  offline: boolean;
  lastSaved: string;
  conflictMessage: string;
  signatures: StageSignature[];
  released: boolean;
  audit: { time: string; actor: string; action: string; detail: string }[];
  appliedBatches: AppliedBatch[];
  lastTransferError: string;
};

const now = () => new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

const STATION = '上海浦东 · H3 机库';

const initialCards: OfflineCard[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署', aircraft: TARGET_AIRCRAFT, sourceHangars: [STATION], evidenceFiles: [{ id: 'EV-01-LOCAL', name: '近照_动作记录.jpg' }] },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署', aircraft: TARGET_AIRCRAFT, sourceHangars: [STATION], evidenceFiles: [] },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署', aircraft: TARGET_AIRCRAFT, sourceHangars: [STATION], evidenceFiles: [{ id: 'EV-03-LOCAL', name: '液压测试原始记录.pdf' }] },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署', aircraft: TARGET_AIRCRAFT, sourceHangars: [STATION], evidenceFiles: [] },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署', aircraft: TARGET_AIRCRAFT, sourceHangars: [STATION], evidenceFiles: [] },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署', aircraft: TARGET_AIRCRAFT, sourceHangars: [STATION], evidenceFiles: [] },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署', aircraft: TARGET_AIRCRAFT, sourceHangars: [STATION], evidenceFiles: [] },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署', aircraft: TARGET_AIRCRAFT, sourceHangars: [STATION], evidenceFiles: [] }
];

// 旧版本 localStorage 状态缺少新字段，按本站历史兼容迁移
function hydrate(raw: Partial<MaintenanceState> | null): MaintenanceState {
  const fallback: MaintenanceState = {
    cards: initialCards,
    activeCardId: 'CARD-03',
    syncVersion: 7,
    serverVersion: 7,
    offline: false,
    lastSaved: '09:46',
    conflictMessage: '',
    signatures: [
      { stage: '机械', status: '已签署', actor: '赵明 · 机械师', time: '09:18', invalidated: false },
      { stage: '系统', status: '待签署', actor: '待指定', time: '-', invalidated: false },
      { stage: '动力', status: '待签署', actor: '待指定', time: '-', invalidated: false },
      { stage: '放行', status: '待签署', actor: '质量经理', time: '-', invalidated: false }
    ],
    released: false,
    audit: [
      { time: '08:54', actor: '赵明', action: '完成工卡', detail: 'CARD-01 间隙测量 1.62 mm' },
      { time: '09:05', actor: '宋杰', action: '提交测量', detail: 'CARD-03 压力 2762 psi，低于容差' },
      { time: '09:20', actor: '系统', action: '阻断', detail: 'CARD-03 等待授权处理' }
    ],
    appliedBatches: [],
    lastTransferError: ''
  };
  if (!raw) return fallback;

  const cards = (raw.cards ?? initialCards).map((card) => ({
    ...card,
    aircraft: card.aircraft ?? TARGET_AIRCRAFT,
    // 旧包没有来源机库标记：按本站历史兼容
    sourceHangars: card.sourceHangars ?? [hangarLabel('')],
    legacy: card.legacy ?? (card.sourceHangars ? card.legacy : true),
    evidenceFiles: card.evidenceFiles ?? [],
    status: card.status === '挂起' ? '执行中' : card.status
  })) as OfflineCard[];

  return {
    ...fallback,
    ...raw,
    cards,
    signatures: (raw.signatures ?? fallback.signatures).map((signature) => ({ ...signature, invalidated: signature.invalidated ?? false })),
    appliedBatches: raw.appliedBatches ?? [],
    lastTransferError: raw.lastTransferError ?? '',
    released: raw.released ?? false
  };
}

const savedRaw = typeof localStorage !== 'undefined' ? localStorage.getItem('yy61-work-package') : null;
const initialState: MaintenanceState = hydrate(savedRaw ? JSON.parse(savedRaw) : null);

// 本站当前包 → 合并基线记录（带本站机库标记）
function baselineRecords(state: MaintenanceState): CardRecord[] {
  return state.cards.map((card) => {
    const signatures: SignatureValue[] = state.signatures
      .filter((signature) => signature.status === '已签署' && stageKeyOf(signature.stage) === stageKeyOf(card.stage))
      .map((signature) => ({ stage: signature.stage === card.stage ? signature.stage : card.stage, actor: signature.actor, time: signature.time }));
    return {
      cardId: card.id,
      title: card.title,
      zone: card.zone,
      estimated: card.estimated,
      dependencies: card.dependencies,
      tolerance: card.tolerance,
      evidenceRequired: card.evidence,
      witness: card.witness,
      stage: card.stage,
      aircraft: card.aircraft,
      hangar: STATION,
      status: card.status === '挂起' ? '执行中' : card.status,
      measurement: card.measurement,
      finding: card.finding,
      evidence: card.evidenceFiles,
      signatures,
      releaseNote: card.releaseNote ?? null,
      completed: card.status === '已完成'
    };
  });
}

// 测量或证据补交后：相关阶段签字与放行结论立即失效
function invalidateSignatures(state: MaintenanceState, stageKeys: string[], reason: string) {
  const keys = new Set([...stageKeys, '放行']);
  let changed = false;
  for (const signature of state.signatures) {
    if (keys.has(stageKeyOf(signature.stage)) && signature.status === '已签署' && !signature.invalidated) {
      signature.invalidated = true;
      signature.invalidatedReason = reason;
      changed = true;
    }
  }
  if (changed) {
    state.released = false;
    state.audit.unshift({
      time: now(),
      actor: '系统',
      action: '签字失效重算',
      detail: `${[...keys].filter((key) => key !== '放行').join('、') || '相关'}阶段签字与放行结论因${reason}失效，需重新签署`
    });
  }
}

const slice = createSlice({
  name: 'maintenance',
  initialState,
  reducers: {
    selectCard(state, action: PayloadAction<string>) {
      state.activeCardId = action.payload;
    },
    updateCard(state, action: PayloadAction<Partial<OfflineCard>>) {
      const card = state.cards.find((item) => item.id === state.activeCardId);
      if (!card) return;
      const measurementChanged = action.payload.measurement !== undefined && action.payload.measurement !== card.measurement;
      const evidenceChanged = action.payload.evidenceFiles !== undefined && action.payload.evidenceFiles.length !== card.evidenceFiles.length;
      Object.assign(card, action.payload);
      state.syncVersion += 1;
      state.lastSaved = now();
      state.audit.unshift({ time: state.lastSaved, actor: '当前用户', action: '离线暂存', detail: `${card.id} 已保存本地草稿` });
      if (measurementChanged || evidenceChanged) {
        invalidateSignatures(state, [stageKeyOf(card.stage)], measurementChanged ? '测量值补交/变更' : '证据补交');
      }
    },
    supplementEvidence(state, action: PayloadAction<{ cardId: string; file: EvidenceFile }>) {
      const card = state.cards.find((item) => item.id === action.payload.cardId);
      if (!card) return;
      if (card.evidenceFiles.some((file) => file.id === action.payload.file.id)) return;
      card.evidenceFiles.push(action.payload.file);
      state.syncVersion += 1;
      state.lastSaved = now();
      state.audit.unshift({ time: state.lastSaved, actor: '当前用户', action: '证据补交', detail: `${card.id} 补交证据 ${action.payload.file.name}` });
      invalidateSignatures(state, [stageKeyOf(card.stage)], '证据补交');
    },
    setConflict(state, action: PayloadAction<string>) {
      state.conflictMessage = action.payload;
    },
    refreshVersion(state) {
      state.syncVersion = state.serverVersion;
      state.conflictMessage = '';
    },
    toggleOffline(state) {
      state.offline = !state.offline;
    },
    authorizeOverride(state) {
      const card = state.cards.find((item) => item.id === state.activeCardId);
      if (!card) return;
      card.status = '执行中';
      card.finding = '超差已由授权人员批准，按工程指令继续';
      state.audit.unshift({ time: now(), actor: '放行授权人', action: '授权继续', detail: `${card.id} 超差放行审批` });
    },
    signStage(state, action: PayloadAction<string>) {
      const stage = action.payload;
      let signature = state.signatures.find((item) => item.stage === stage);
      if (!signature) {
        signature = { stage, status: '待签署', actor: '待指定', time: '-' };
        state.signatures.push(signature);
      }
      signature.status = '已签署';
      signature.actor = `${stage}负责人`;
      signature.time = now();
      signature.invalidated = false;
      signature.invalidatedReason = undefined;
      state.audit.unshift({ time: signature.time, actor: signature.actor, action: '阶段签署', detail: `${stage}阶段确认完成（重算后重签）` });
    },
    releasePackage(state) {
      const hasBlockers = state.cards.some((card) => card.status === '待授权' || card.status === '挂起');
      const hasInvalid = state.signatures.some((signature) => signature.status !== '已签署' || signature.invalidated);
      if (!hasBlockers && !hasInvalid) {
        state.released = true;
        state.audit.unshift({ time: now(), actor: '质量经理', action: '锁定放行', detail: '工作包已按重算结果锁定并形成放行基线' });
      }
    },
    // —— 转站接收：把服务端批次结果合并进当前包（幂等：同批次号只应用一次） ——
    applyTransferResult(state, action: PayloadAction<TransferResult>) {
      const result = action.payload;
      if (state.appliedBatches.some((batch) => batch.batchId === result.batchId)) return;
      state.lastTransferError = '';

      const merged = deriveMergedCards([...baselineRecords(state), ...result.committedRecords]);
      let suspended = 0;
      let autoCompleted = 0;
      let dedupeEvidence = 0;
      let dedupeSignatures = 0;
      let dedupeReleaseNotes = 0;
      let dedupeCompletion = 0;

      for (const mergeCard of merged.values()) {
        // 服务端只认领本飞机的记录；其余在 unclaimed 中提示
        if (!result.mergedCardIds.includes(mergeCard.cardId)) continue;
        const card = state.cards.find((item) => item.id === mergeCard.cardId);
        if (!card) continue;

        for (const source of mergeCard.sources) {
          if (!card.sourceHangars.includes(source)) card.sourceHangars.push(source);
        }
        if (mergeCard.legacy) card.legacy = true;
        mergeCard.title && (card.title = mergeCard.title);
        mergeCard.zone && (card.zone = mergeCard.zone);
        mergeCard.stage && (card.stage = mergeCard.stage);
        if (mergeCard.estimated !== undefined) card.estimated = mergeCard.estimated;
        if (mergeCard.dependencies) card.dependencies = mergeCard.dependencies;
        if (mergeCard.tolerance) card.tolerance = mergeCard.tolerance;
        if (mergeCard.evidenceRequired) card.evidence = mergeCard.evidenceRequired;
        if (mergeCard.witness) card.witness = mergeCard.witness;

        dedupeEvidence += mergeCard.dedupe.evidence;
        dedupeSignatures += mergeCard.dedupe.signatures;
        dedupeReleaseNotes += mergeCard.dedupe.releaseNotes;
        dedupeCompletion += mergeCard.dedupe.completion;

        // 证据不涉及争议时，无论卡片是否挂起都先并入（同编号已在合并时去重）
        if (!mergeCard.conflicts.some((conflict) => conflict.field === 'evidence')) {
          for (const file of mergeCard.evidence) {
            if (!card.evidenceFiles.some((existing) => existing.id === file.id)) card.evidenceFiles.push(file);
          }
        }

        const disputedStages = mergeCard.conflicts
          .filter((conflict) => conflict.field === 'signature')
          .map((conflict) => conflict.fieldLabel.replace(/阶段签署|签署/g, ''));

        // 无争议的阶段签署并入全局签字表：同阶段同人只签一次
        for (const sig of mergeCard.signatures) {
          if (disputedStages.includes(stageKeyOf(sig.stage))) continue;
          const key = stageKeyOf(sig.stage);
          let target = state.signatures.find((item) => stageKeyOf(item.stage) === key);
          if (!target) {
            target = { stage: key, status: '待签署', actor: '待指定', time: '-' };
            state.signatures.push(target);
          }
          if (target.status !== '已签署') {
            target.status = '已签署';
            target.actor = sig.actor;
            target.time = sig.time;
            target.invalidated = false;
          }
        }

        if (mergeCard.conflicts.length > 0) {
          // 不一致 → 挂起，两套原值完整保留在 conflict 中，不覆盖当前值
          card.status = '挂起';
          card.conflict = { conflicts: mergeCard.conflicts, sources: mergeCard.sources, suspendedAt: now() };
          suspended += 1;
          // 争议字段对应的原签字基础已变化：失效重算
          invalidateSignatures(state, disputedStages, '转站记录不一致挂起');
          state.audit.unshift({
            time: now(),
            actor: '转站接收',
            action: '冲突挂起',
            detail: `${card.id} ${mergeCard.conflicts.map((conflict) => conflict.fieldLabel).join('、')}在 ${mergeCard.sources.join(' / ')} 间不一致，两份原值已保留`
          });
          continue;
        }

        // —— 无冲突：测量、放行单并进当前包 ——
        if (mergeCard.measurement !== undefined) card.measurement = mergeCard.measurement;
        if (mergeCard.finding) card.finding = mergeCard.finding;
        if (mergeCard.releaseNote) card.releaseNote = mergeCard.releaseNote;
        if (statusRank[mergeCard.status] > statusRank[card.status === '挂起' ? '执行中' : card.status]) {
          card.status = mergeCard.status;
        }
        if (mergeCard.completed && card.status !== '已完成') {
          card.status = '已完成';
          autoCompleted += 1;
        }
      }

      state.appliedBatches.push({
        batchId: result.batchId,
        attempts: result.attempts,
        coalesced: result.coalesced,
        mergedCardIds: result.mergedCardIds,
        unclaimed: result.unclaimed,
        committedRecords: result.committedRecords,
        time: now()
      });
      state.syncVersion = state.serverVersion;
      state.conflictMessage = '';
      state.lastSaved = now();
      if (suspended > 0) state.released = false;

      const dedupeBits: string[] = [];
      if (dedupeEvidence) dedupeBits.push(`证据去重 ${dedupeEvidence}`);
      if (dedupeSignatures) dedupeBits.push(`签署去重 ${dedupeSignatures}`);
      if (dedupeReleaseNotes) dedupeBits.push(`放行单去重 ${dedupeReleaseNotes}`);
      if (dedupeCompletion) dedupeBits.push(`完成数去重 ${dedupeCompletion}`);
      state.audit.unshift({
        time: state.lastSaved,
        actor: '转站接收',
        action: '合并批次',
        detail: `${result.batchId} 并入 ${result.mergedCardIds.length} 张工卡${suspended ? `，${suspended} 张挂起` : ''}${autoCompleted ? `，${autoCompleted} 张自动完成` : ''}${dedupeBits.length ? `（${dedupeBits.join('、')}）` : ''}${result.coalesced ? '，两座机库同批次已合流只成一次' : ''}${result.unclaimed.length ? `，${result.unclaimed.length} 条登记号不符未认领` : ''}`
      });
    },
    setTransferError(state, action: PayloadAction<string>) {
      state.lastTransferError = action.payload;
    },
    // 挂起工卡：接线员选定采纳某来源机库的原值后解挂，相关签字仍需重算重签
    resolveConflict(state, action: PayloadAction<{ cardId: string; hangar: string }>) {
      const card = state.cards.find((item) => item.id === action.payload.cardId);
      if (!card?.conflict) return;
      const records = state.appliedBatches
        .flatMap((batch) => batch.committedRecords)
        .filter((record) => record.cardId === card.id && hangarLabel(record.hangar) === action.payload.hangar);
      const chosen = records[records.length - 1];
      if (!chosen) return;

      const conflictFields = new Set(card.conflict.conflicts.map((conflict) => conflict.field));
      if (conflictFields.has('measurement') && chosen.measurement) card.measurement = chosen.measurement;
      if (chosen.finding) card.finding = chosen.finding;
      if (conflictFields.has('evidence')) {
        for (const incoming of chosen.evidence ?? []) {
          const existing = card.evidenceFiles.find((file) => file.id === incoming.id);
          if (existing) existing.name = incoming.name;
          else card.evidenceFiles.push(incoming);
        }
      }
      if (conflictFields.has('releaseNote') && chosen.releaseNote) card.releaseNote = chosen.releaseNote;
      if (conflictFields.has('signature')) {
        for (const sig of chosen.signatures ?? []) {
          const key = stageKeyOf(sig.stage);
          const target = state.signatures.find((item) => stageKeyOf(item.stage) === key);
          if (target) {
            target.status = '待签署';
            target.invalidated = true;
            target.invalidatedReason = '按选定来源值重算，需重签';
          }
        }
      }
      invalidateSignatures(state, [stageKeyOf(card.stage)], '挂起工卡按来源值解挂重算');

      card.conflict = undefined;
      card.status = chosen.completed || chosen.status === '已完成' ? '已完成' : chosen.status;
      state.released = false;
      state.audit.unshift({
        time: now(),
        actor: '转站接收',
        action: '解挂确认',
        detail: `${card.id} 采纳「${action.payload.hangar}」原值，相关签字失效后重算，放行结论待重签`
      });
    }
  }
});

export const {
  selectCard,
  updateCard,
  supplementEvidence,
  setConflict,
  refreshVersion,
  toggleOffline,
  authorizeOverride,
  signStage,
  releasePackage,
  applyTransferResult,
  setTransferError,
  resolveConflict
} = slice.actions;

export const store = configureStore({
  reducer: { maintenance: slice.reducer, [maintenanceApi.reducerPath]: maintenanceApi.reducer },
  middleware: (getDefault) => getDefault().concat(maintenanceApi.middleware)
});

store.subscribe(() => {
  if (typeof localStorage !== 'undefined') localStorage.setItem('yy61-work-package', JSON.stringify(store.getState().maintenance));
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

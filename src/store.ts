import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { maintenanceApi } from './api';
import {
  buildInitialBatches,
  findSignatureForStage,
  type MergeConflict,
  type OfflineCard,
  type ReceptionOutcome,
  type StageSignature,
  type TransferBatch
} from './transfer';

export type { OfflineCard, StageSignature };

type MaintenanceState = {
  aircraft: string;
  cards: OfflineCard[];
  activeCardId: string;
  syncVersion: number;
  serverVersion: number;
  offline: boolean;
  lastSaved: string;
  conflictMessage: string;
  signatures: StageSignature[];
  released: boolean;
  transferBatches: TransferBatch[];
  conflicts: MergeConflict[];
  processedBatchNos: string[];
  audit: { time: string; actor: string; action: string; detail: string }[];
};

const initialCards: OfflineCard[] = [
  { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署', evidenceFiles: [] },
  { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署', evidenceFiles: [] },
  { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署', evidenceFiles: [] },
  { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署', evidenceFiles: [] },
  { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署', evidenceFiles: [] },
  { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署', evidenceFiles: [] },
  { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署', evidenceFiles: [] },
  { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署', evidenceFiles: [] }
];

const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('yy61-work-package') : null;
const saved = raw ? (JSON.parse(raw) as Partial<MaintenanceState>) : null;

const defaultSignatures: StageSignature[] = [
  { stage: '机械', status: '已签署', actor: '赵明 · 机械师', time: '09:18' },
  { stage: '系统', status: '待签署', actor: '待指定', time: '-' },
  { stage: '动力', status: '待签署', actor: '待指定', time: '-' },
  { stage: '放行', status: '待签署', actor: '质量经理', time: '-' }
];

const initialState: MaintenanceState = {
  cards: initialCards,
  activeCardId: 'CARD-03',
  syncVersion: 7,
  serverVersion: 7,
  offline: false,
  lastSaved: '09:46',
  conflictMessage: '',
  signatures: defaultSignatures,
  released: false,
  audit: [
    { time: '08:54', actor: '赵明', action: '完成工卡', detail: 'CARD-01 间隙测量 1.62 mm' },
    { time: '09:05', actor: '宋杰', action: '提交测量', detail: 'CARD-03 压力 2762 psi，低于容差' },
    { time: '09:20', actor: '系统', action: '阻断', detail: 'CARD-03 等待授权处理' }
  ],
  ...saved,
  // 合并持久化数据时补齐新字段，避免旧存档缺字段。
  aircraft: saved?.aircraft ?? 'B-7891',
  transferBatches: saved?.transferBatches ?? buildInitialBatches(),
  conflicts: saved?.conflicts ?? [],
  processedBatchNos: saved?.processedBatchNos ?? []
};

function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
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
      Object.assign(card, action.payload);
      state.syncVersion += 1;
      state.lastSaved = nowTime();
      state.audit.unshift({ time: state.lastSaved, actor: '当前用户', action: '离线暂存', detail: `${card.id} 已保存本地草稿` });
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
      state.audit.unshift({ time: nowTime(), actor: '放行授权人', action: '授权继续', detail: `${card.id} 超差放行审批` });
    },
    signStage(state, action: PayloadAction<string>) {
      const signature = state.signatures.find((item) => item.stage === action.payload);
      if (!signature) return;
      signature.status = '已签署';
      signature.actor = `${action.payload}负责人`;
      signature.time = nowTime();
      state.audit.unshift({ time: signature.time, actor: signature.actor, action: '阶段签署', detail: `${action.payload}阶段确认完成` });
    },
    releasePackage(state) {
      const hasBlockers = state.cards.some((card) => card.status === '待授权');
      const allSigned = state.signatures.every((item) => item.status === '已签署');
      if (!hasBlockers && allSigned) {
        state.released = true;
        state.audit.unshift({ time: nowTime(), actor: '质量经理', action: '锁定放行', detail: '工作包已锁定并形成放行基线' });
      }
    },
    // 应用一次转站接收结果（commit=false 表示写入失败的部分结果）。
    applyReception(state, action: PayloadAction<{ outcome: ReceptionOutcome; commit: boolean }>) {
      const { outcome, commit } = action.payload;
      const batch = state.transferBatches.find((item) => item.batchNo === outcome.batchNo);
      if (!batch) return;

      if (outcome.duplicate) {
        batch.status = '已接收';
        batch.attempts += 1;
        state.audit.unshift({ time: nowTime(), actor: '系统', action: '转站接收', detail: `批次 ${outcome.batchNo} 重复提交，按批次号仅成一次，已忽略` });
        return;
      }

      for (const change of outcome.changes) {
        const card = state.cards.find((item) => item.id === change.cardId);
        if (!card) continue;
        if (change.measurement !== undefined) card.measurement = change.measurement;
        if (change.finding !== undefined) card.finding = change.finding;
        if (change.evidenceFiles !== undefined) card.evidenceFiles = change.evidenceFiles;
        if (change.status !== undefined) card.status = change.status;
      }

      for (const merge of outcome.signatureMerges) {
        let signature = state.signatures.find((item) => item.stage === merge.stage);
        if (!signature) {
          signature = { stage: merge.stage, status: '待签署', actor: '待指定', time: '-' };
          state.signatures.push(signature);
        }
        signature.status = '已签署';
        signature.actor = merge.actor;
        signature.time = merge.time;
      }

      for (const conflict of outcome.conflicts) {
        if (!state.conflicts.some((item) => item.cardId === conflict.cardId && item.field === conflict.field)) {
          state.conflicts.push(conflict);
        }
      }

      const mergedIds = new Set(batch.mergedCardIds);
      for (const change of outcome.changes) mergedIds.add(change.cardId);
      for (const conflict of outcome.conflicts) mergedIds.add(conflict.cardId);
      batch.mergedCardIds = [...mergedIds];
      batch.conflictCardIds = outcome.conflicts.map((item) => item.cardId);
      batch.rejectedCardIds = outcome.rejected.map((item) => item.cardId);
      batch.attempts += 1;
      batch.status = commit ? '已接收' : '写入失败';

      const scope = outcome.legacy ? '本站历史兼容' : '外站转入';
      if (commit) {
        if (!state.processedBatchNos.includes(batch.batchNo)) state.processedBatchNos.push(batch.batchNo);
        const parts = [`批次 ${outcome.batchNo}（${batch.sourceHangar || '无来源标记'}）${scope}：并入 ${outcome.changes.length} 项`];
        if (outcome.evidenceAdded) parts.push(`证据 ${outcome.evidenceAdded} 份`);
        if (outcome.signatureMerges.length) parts.push(`阶段签署 ${outcome.signatureMerges.length} 项`);
        if (outcome.conflicts.length) parts.push(`挂起 ${outcome.conflicts.length} 项（保留两份原值）`);
        if (outcome.rejected.length) parts.push(`认领失败 ${outcome.rejected.length} 项`);
        state.audit.unshift({ time: nowTime(), actor: '系统', action: '转站接收', detail: parts.join('，') });
        // 新数据并入后，旧放行基线失效，必须重新计算并锁定。
        state.released = false;
      } else {
        state.audit.unshift({ time: nowTime(), actor: '系统', action: '写入失败', detail: `批次 ${outcome.batchNo} 部分写入失败，已回到接站前；重试只补尚未并入的工卡` });
      }
    },
    // 补交测量或证据：相关阶段签字与放行结论立即失效并重算。
    supplementConflict(state, action: PayloadAction<{ cardId: string; measurement: string; evidenceFiles: string[] }>) {
      const conflict = state.conflicts.find((item) => item.cardId === action.payload.cardId && item.status === '挂起');
      if (!conflict) return;
      conflict.status = '已补交';
      conflict.resolvedValue = action.payload.measurement;
      conflict.resolvedEvidence = action.payload.evidenceFiles;

      const card = state.cards.find((item) => item.id === action.payload.cardId);
      if (card) {
        card.measurement = action.payload.measurement;
        card.evidenceFiles = [...(card.evidenceFiles ?? []), ...action.payload.evidenceFiles];
        card.status = '执行中';
        // 补交后相关阶段签字立即失效，需重新签署。
        const prefix = card.stage.replace(/签署$/, '');
        let signature = state.signatures.find((item) => item.stage === prefix || card.stage.startsWith(item.stage));
        if (!signature) {
          signature = { stage: prefix, status: '待签署', actor: '待指定', time: '-' };
          state.signatures.push(signature);
        }
        signature.status = '待签署';
        signature.actor = '待指定';
        signature.time = '-';
      }
      // 放行结论立即失效，按当前包状态重新计算。
      state.released = false;
      state.audit.unshift({ time: nowTime(), actor: '当前用户', action: '补交重算', detail: `${action.payload.cardId} 补交测量与证据，相关阶段签字与放行结论已失效重算` });
    }
  }
});

export const {
  selectCard,
  updateCard,
  setConflict,
  refreshVersion,
  toggleOffline,
  authorizeOverride,
  signStage,
  releasePackage,
  applyReception,
  supplementConflict
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

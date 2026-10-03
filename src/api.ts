import { createApi } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn } from '@reduxjs/toolkit/query';
import { TARGET_AIRCRAFT, TransferWriteFailure, type CardRecord, type TransferResult } from './transfer';

export type WorkCard = {
  id: string;
  title: string;
  zone: string;
  revision: string;
  estimated: number;
  dependencies: string[];
  tolerance: string;
  evidence: string;
  witness: string;
  status: '未开始' | '执行中' | '待授权' | '已完成';
  measurement: string;
  finding: string;
  stage: string;
};

const packageData = {
  id: 'WP-B7891-04',
  aircraft: 'B-7891',
  type: 'B737-800',
  check: '48A 定检',
  station: '上海浦东 · H3 机库',
  plannedStart: '2026-09-28 06:00',
  plannedEnd: '2026-09-30 18:00',
  revision: 'WP R7',
  serverRevision: 7,
  tasks: [
    { id: 'CARD-01', title: '右主起落架收放检查', zone: '起落架舱 RH', revision: 'R7', estimated: 3.5, dependencies: [], tolerance: '间隙 1.2–2.0 mm', evidence: '近照 + 动作记录', witness: '检验员', status: '已完成', measurement: '1.62 mm', finding: '正常', stage: '机械签署' },
    { id: 'CARD-02', title: '发动机 2 风扇叶片孔探', zone: '发动机 2', revision: 'R7', estimated: 4.2, dependencies: ['CARD-01'], tolerance: '凹坑 ≤ 0.3 mm', evidence: '孔探照片 + 视频', witness: '发动机工程师', status: '执行中', measurement: '', finding: '', stage: '发动机签署' },
    { id: 'CARD-03', title: '液压系统压力保持测试', zone: '轮舱 / 系统 A', revision: 'R6', estimated: 2.0, dependencies: ['CARD-01'], tolerance: '≥ 2850 psi / 10 min', evidence: '压力仪记录', witness: '质量检验', status: '待授权', measurement: '2762 psi', finding: '低于容差，等待授权', stage: '系统签署' },
    { id: 'CARD-04', title: '前起落架时寿件核对', zone: '前起落架', revision: 'R7', estimated: 1.5, dependencies: [], tolerance: '剩余循环 ≥ 500', evidence: '件号照片 + 履历页', witness: '检验员', status: '已完成', measurement: '剩余 836 循环', finding: '正常', stage: '适航签署' },
    { id: 'CARD-05', title: 'AD 2024-15-03 执行确认', zone: '机身后段', revision: 'R7', estimated: 2.5, dependencies: ['CARD-04'], tolerance: '按 AD 标准施工', evidence: '施工记录 + 签署', witness: '放行人员', status: '未开始', measurement: '', finding: '', stage: '适航签署' },
    { id: 'CARD-06', title: '客舱应急设备检查', zone: '客舱全舱', revision: 'R7', estimated: 2.8, dependencies: [], tolerance: '全部在有效期内', evidence: '清单复核', witness: '客舱检验', status: '未开始', measurement: '', finding: '', stage: '客舱签署' },
    { id: 'CARD-07', title: 'APU 排故后试车', zone: 'APU 舱', revision: 'R5', estimated: 3.0, dependencies: ['CARD-03'], tolerance: '参数在 AMM 范围', evidence: '试车数据 + 油样', witness: '动力工程师', status: '未开始', measurement: '', finding: '', stage: '动力签署' },
    { id: 'CARD-08', title: '重复缺陷趋势复核', zone: '全机', revision: 'R7', estimated: 1.0, dependencies: ['CARD-02', 'CARD-03'], tolerance: '无新增重复缺陷', evidence: '近 3 次记录', witness: '质量经理', status: '执行中', measurement: '发现 2 次压力偏低', finding: '移交可靠性分析', stage: '放行签署' }
  ] as WorkCard[]
};

// —— 外站转来的待接收批次（两座机库各自的半包测量与签署） ——
export type InboundBatchGroup = {
  hangar: string;
  receivedAt: string;
  records: CardRecord[];
};

export type InboundBatch = {
  batchId: string;
  fromStation: string;
  note: string;
  groups: InboundBatchGroup[];
};

const H1 = '厦门 · G1 机库';
const H2 = '厦门 · G2 机库';

export const inboundBatches: InboundBatch[] = [
  {
    batchId: 'XFER-20260930-01',
    fromStation: '厦门高崎（外站半包转来）',
    note: '两座机库同时提交同一批次，按批次号只成一次；同包测量/签署先在服务端合流。',
    groups: [
      {
        hangar: H1,
        receivedAt: '10:12',
        records: [
          // 无冲突：G1 已完成的孔探，测量与证据将并入当前包，完成数只计一次
          { cardId: 'CARD-02', aircraft: TARGET_AIRCRAFT, hangar: H1, status: '已完成', completed: true, measurement: '凹坑 0.12 mm', finding: '符合凹坑 ≤ 0.3 mm', stage: '发动机签署',
            evidence: [{ id: 'EV-02-01', name: '孔探照片_01.jpg' }, { id: 'EV-02-02', name: '孔探视频.mp4' }],
            signatures: [{ stage: '发动机签署', actor: '何磊 · 发动机工程师', time: '10:04' }] },
          // 测量冲突：与 G2 的 0.12 vs 0.26 不一致 → 挂起，保留两份原值
          { cardId: 'CARD-03', aircraft: TARGET_AIRCRAFT, hangar: H1, status: '执行中', measurement: '2888 psi', finding: '复测达标，建议关闭超差', stage: '系统签署',
            evidence: [{ id: 'EV-03-01', name: '压力仪记录_复测.pdf' }],
            signatures: [{ stage: '系统签署', actor: '周岩 · 系统检验', time: '10:08' }] },
          // 完成单去重 + 放行单去重
          { cardId: 'CARD-04', aircraft: TARGET_AIRCRAFT, hangar: H1, status: '已完成', completed: true, measurement: '剩余 836 循环', finding: '正常', stage: '适航签署',
            evidence: [{ id: 'EV-04-01', name: '时寿件履历页.pdf' }],
            signatures: [{ stage: '适航签署', actor: '陈静 · 检验员', time: '10:10' }],
            releaseNote: { id: 'RL-CARD04-G1', ref: '时寿件核对放行签注 · 陈静' } },
          // 新机库补充的客舱工卡，无冲突并入
          { cardId: 'CARD-06', aircraft: TARGET_AIRCRAFT, hangar: H1, status: '已完成', completed: true, finding: '应急设备全部在有效期内', stage: '客舱签署',
            evidence: [{ id: 'EV-06-01', name: '应急设备清单复核.pdf' }],
            signatures: [{ stage: '客舱签署', actor: '林珊 · 客舱检验', time: '10:02' }] },
          // 放行结论与 G2 不一致（同阶段签署人不同 + 放行单不同）→ 挂起保留两份
          { cardId: 'CARD-08', aircraft: TARGET_AIRCRAFT, hangar: H1, status: '已完成', completed: true, measurement: '发现 2 次压力偏低', finding: '已移交可靠性分析', stage: '放行签署',
            evidence: [{ id: 'EV-08-01', name: '近3次压力记录.pdf' }],
            signatures: [{ stage: '放行签署', actor: '许峰 · 质量经理', time: '10:07' }],
            releaseNote: { id: 'RL-CARD08-G1', ref: '重复缺陷复核暂缓放行 · 许峰' } }
        ]
      },
      {
        hangar: H2,
        receivedAt: '10:12',
        records: [
          // 与 G1 完全一致：证据/签署/完成去重，不产生重复完成数与重复放行单
          { cardId: 'CARD-02', aircraft: TARGET_AIRCRAFT, hangar: H2, status: '已完成', completed: true, measurement: '凹坑 0.12 mm', finding: '符合凹坑 ≤ 0.3 mm', stage: '发动机签署',
            evidence: [{ id: 'EV-02-01', name: '孔探照片_01.jpg' }, { id: 'EV-02-02', name: '孔探视频.mp4' }],
            signatures: [{ stage: '发动机签署', actor: '何磊 · 发动机工程师', time: '10:04' }] },
          // CARD-03 测量冲突的另一原值；同编号证据名称一致不冲突；签署人不同也挂起
          { cardId: 'CARD-03', aircraft: TARGET_AIRCRAFT, hangar: H2, status: '执行中', measurement: '2762 psi', finding: '压力仍偏低，建议继续挂起', stage: '系统签署',
            evidence: [{ id: 'EV-03-01', name: '压力仪记录_复测.pdf' }],
            signatures: [{ stage: '系统签署', actor: '高鹏 · 系统检验', time: '10:09' }] },
          // 完成单与放行单各重复一次（同编号同引用）→ 去重
          { cardId: 'CARD-04', aircraft: TARGET_AIRCRAFT, hangar: H2, status: '已完成', completed: true, measurement: '剩余 836 循环', finding: '正常', stage: '适航签署',
            evidence: [{ id: 'EV-04-01', name: '时寿件履历页.pdf' }],
            signatures: [{ stage: '适航签署', actor: '陈静 · 检验员', time: '10:10' }],
            releaseNote: { id: 'RL-CARD04-G1', ref: '时寿件核对放行签注 · 陈静' } },
          // 放行结论不一致：G1 无放行签注，G2 放行签署人不同 → 挂起保留两份
          { cardId: 'CARD-08', aircraft: TARGET_AIRCRAFT, hangar: H2, status: '已完成', completed: true, measurement: '发现 2 次压力偏低', finding: '已移交可靠性分析', stage: '放行签署',
            evidence: [{ id: 'EV-08-01', name: '近3次压力记录.pdf' }],
            signatures: [{ stage: '放行签署', actor: '郑凯 · 质量经理', time: '10:11' }],
            releaseNote: { id: 'RL-CARD08-G2', ref: '重复缺陷复核放行 · 郑凯' } },
          // 认领失败：登记号不属于当前包 B-7891
          { cardId: 'CARD-99', aircraft: 'B-2031', hangar: H2, status: '已完成', completed: true, measurement: '不相关飞机数据', stage: '机械签署' }
        ]
      }
    ]
  },
  {
    // 旧包没有来源机库标记：按本站历史兼容并入
    batchId: 'XFER-20260929-LEGACY',
    fromStation: '本站历史半包（旧包，无来源机库标记）',
    note: '旧包记录缺少来源机库标记，按本站历史兼容处理；同值并入、异值仍需挂起。',
    groups: [
      {
        hangar: '',
        receivedAt: '昨日 18:40',
        records: [
          { cardId: 'CARD-01', aircraft: TARGET_AIRCRAFT, hangar: '', status: '已完成', completed: true, measurement: '1.62 mm', finding: '正常', stage: '机械签署',
            evidence: [{ id: 'EV-01-01', name: '近照_起落架.jpg' }],
            signatures: [{ stage: '机械签署', actor: '赵明 · 机械师', time: '昨日 18:22' }],
            releaseNote: { id: 'RL-CARD01-OLD', ref: '收放检查签注 · 赵明' } },
          { cardId: 'CARD-07', aircraft: TARGET_AIRCRAFT, hangar: '', status: '执行中', measurement: 'APU 参数在 AMM 范围', finding: '试车数据待补交', stage: '动力签署',
            evidence: [{ id: 'EV-07-01', name: 'APU试车数据_初版.csv' }] }
        ]
      }
    ]
  }
];

// —— 服务端批次状态机：批次号只成一次；写入失败仅落首批工卡；重试只补尚未并入的工卡 ——
type ServerBatch = {
  status: 'inflight' | '已并批';
  inflight: Promise<TransferResult> | null;
  queuedGroups: InboundBatchGroup[];
  attempts: number;
  coalesced: boolean;
  failFirstWrite: boolean;
  failureConsumed: boolean;
  committed: CardRecord[];
  result: TransferResult | null;
};

const batchStore = new Map<string, ServerBatch>();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function settleBatch(batchId: string, aircraft: string): Promise<TransferResult> {
  await delay(320);
  const batch = batchStore.get(batchId)!;
  batch.attempts += 1;

  // 本轮认领：按 工卡编号 + 飞机登记号，已提交的工卡不再重复并入
  const groups = batch.queuedGroups;
  batch.queuedGroups = [];
  const incoming = groups.flatMap((group) => group.records);
  const claimed = incoming.filter((record) => record.aircraft === aircraft);
  const unclaimed = incoming
    .filter((record) => record.aircraft !== aircraft)
    .map((record) => ({ cardId: record.cardId, aircraft: record.aircraft }));
  const mergedKey = (record: CardRecord) => `${record.cardId}@${record.hangar}`;
  const seen = new Set(batch.committed.map(mergedKey));

  const pending = claimed.filter((record) => !seen.has(mergedKey(record)));
  // 第一次写入失败时只落首批工卡（模拟部分写入），回到接站前由客户端整批回滚；重试只补剩余
  const firstWriteFails = batch.failFirstWrite && !batch.failureConsumed;
  const accepted = firstWriteFails ? pending.slice(0, 1) : pending;

  batch.committed.push(...accepted);
  const committedCopy: CardRecord[] = batch.committed.map((record) => ({ ...record }));
  const mergedCardIds = [...new Set(batch.committed.map((record) => record.cardId))];
  batch.status = '已并批';
  batch.inflight = null;

  if (accepted.length < pending.length) {
    batch.failureConsumed = true;
    throw new TransferWriteFailure(
      `批次 ${batchId} 写入失败：仅 ${accepted.length}/${pending.length} 张工卡落盘，已回到接站前；重试只补尚未并入的 ${pending.length - accepted.length} 张工卡。`,
      [...new Set(accepted.map((record) => record.cardId))]
    );
  }

  batch.result = {
    batchId,
    status: '已并批',
    attempts: batch.attempts,
    coalesced: batch.coalesced,
    committedRecords: committedCopy,
    mergedCardIds,
    unclaimed
  };
  return batch.result;
}

async function submitTransfer(batchId: string, groups: InboundBatchGroup[], aircraft: string, failFirstWrite: boolean): Promise<TransferResult> {
  let batch = batchStore.get(batchId);
  if (!batch) {
    batch = {
      status: 'inflight',
      inflight: null,
      queuedGroups: [],
      attempts: 0,
      coalesced: false,
      failFirstWrite,
      failureConsumed: false,
      committed: [],
      result: null
    };
    batchStore.set(batchId, batch);
  } else if (batch.status === '已并批' && batch.result) {
    // 同一批次重复提交：直接返回既有结果，绝不二次成批
    return batch.result;
  }

  batch.queuedGroups.push(...groups);
  if (batch.inflight) {
    // 两座机库同时提交同一包：并入同一在途批次，只成一次
    batch.coalesced = true;
    return batch.inflight;
  }
  batch.inflight = settleBatch(batchId, aircraft);
  return batch.inflight;
}

const mockBaseQuery: BaseQueryFn = async (arg) => {
  await new Promise((resolve) => setTimeout(resolve, 180));
  if (typeof arg === 'string' && arg === 'package') return { data: packageData };
  if (typeof arg === 'object' && arg !== null && 'url' in arg) {
    const request = arg as { url: string };
    if (request.url === 'package') return { data: packageData };
  }
  return { error: { status: 404, data: 'Not found' } };
};

export type ReceiveTransferRequest = { batchId: string; groups: InboundBatchGroup[]; failFirstWrite: boolean };

export const maintenanceApi = createApi({
  reducerPath: 'maintenanceApi',
  baseQuery: mockBaseQuery,
  tagTypes: ['Package', 'Inbound'],
  endpoints: (builder) => ({
    getWorkPackage: builder.query<typeof packageData, void>({
      query: () => 'package',
      providesTags: ['Package']
    }),
    listInboundBatches: builder.query<InboundBatch[], void>({
      queryFn: async () => ({ data: inboundBatches }),
      providesTags: ['Inbound']
    }),
    submitCard: builder.mutation<{ accepted: boolean; revision: number }, { cardId: string; expectedRevision: number; measurement: string; finding: string }>({
      queryFn: async (payload) => {
        await new Promise((resolve) => setTimeout(resolve, 240));
        if (payload.expectedRevision !== packageData.serverRevision) {
          return { error: { status: 409, data: { message: '版本冲突：服务器已有更新，请刷新后重试。' } } };
        }
        return { data: { accepted: true, revision: packageData.serverRevision + 1 } };
      },
      invalidatesTags: ['Package']
    }),
    receiveTransfer: builder.mutation<TransferResult, ReceiveTransferRequest>({
      queryFn: async ({ batchId, groups, failFirstWrite }) => {
        try {
          const data = await submitTransfer(batchId, groups, TARGET_AIRCRAFT, failFirstWrite);
          return { data };
        } catch (error) {
          if (error instanceof TransferWriteFailure) {
            return { error: { status: 500, data: { message: error.message, partialMergedCardIds: error.data.partialMergedCardIds } } };
          }
          throw error;
        }
      },
      invalidatesTags: ['Inbound']
    })
  })
});

export const { useGetWorkPackageQuery, useSubmitCardMutation, useListInboundBatchesQuery, useReceiveTransferMutation } = maintenanceApi;

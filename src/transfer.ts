// 转站接收合并批次的领域模型与纯函数：
// 认领键 = 工卡编号 + 飞机登记号；两源（或多源）测量/证据/签署不一致即挂起并保留原值。
// 旧包记录没有来源机库标记时，按“本站历史”兼容并入。

export const TARGET_AIRCRAFT = 'B-7891';

export type CardStatus = '未开始' | '执行中' | '待授权' | '已完成';

export type EvidenceFile = { id: string; name: string };
export type SignatureValue = { stage: string; actor: string; time: string };
export type ReleaseNote = { id: string; ref: string };

// 一条来自某机库（或本站、或旧包）的工卡记录
export type CardRecord = {
  cardId: string;
  title?: string;
  zone?: string;
  estimated?: number;
  dependencies?: string[];
  tolerance?: string;
  evidenceRequired?: string;
  witness?: string;
  stage?: string;
  aircraft: string;
  // 来源机库；空串表示旧包没有来源标记（按本站历史兼容）
  hangar: string;
  status: CardStatus;
  measurement?: string;
  finding?: string;
  evidence?: EvidenceFile[];
  signatures?: SignatureValue[];
  releaseNote?: ReleaseNote | null;
  completed?: boolean;
};

export type ConflictValue = { hangar: string; value: string };

export type FieldConflict = {
  field: 'measurement' | 'evidence' | 'signature' | 'releaseNote';
  fieldLabel: string;
  // 两套（或多套）原值，全部保留，不覆盖
  values: ConflictValue[];
};

export type DedupeCount = {
  evidence: number;
  signatures: number;
  releaseNotes: number;
  completion: number;
};

export type MergedCard = {
  cardId: string;
  title?: string;
  zone?: string;
  stage?: string;
  estimated?: number;
  dependencies?: string[];
  tolerance?: string;
  evidenceRequired?: string;
  witness?: string;
  sources: string[];
  legacy: boolean;
  status: CardStatus;
  completed: boolean;
  measurement?: string;
  finding?: string;
  evidence: EvidenceFile[];
  signatures: SignatureValue[];
  releaseNote?: ReleaseNote;
  conflicts: FieldConflict[];
  dedupe: DedupeCount;
};

export type UnclaimedRecord = { cardId: string; aircraft: string };

export type TransferResult = {
  batchId: string;
  status: '已并批';
  attempts: number;
  // 两座机库同时提交同一批次时，服务端只成一次
  coalesced: boolean;
  // 跨尝试累计已提交（claimed）的原始记录
  committedRecords: CardRecord[];
  mergedCardIds: string[];
  unclaimed: UnclaimedRecord[];
};

export class TransferWriteFailure extends Error {
  status = 500;
  data: { message: string; partialMergedCardIds: string[] };
  constructor(message: string, partialMergedCardIds: string[]) {
    super(message);
    this.data = { message, partialMergedCardIds };
  }
}

export const hangarLabel = (hangar?: string) => (hangar && hangar.trim() ? hangar.trim() : '本站历史');

export const stageKeyOf = (stage: string) => stage.replace(/签署$/, '');

export const statusRank: Record<CardStatus, number> = {
  未开始: 0,
  执行中: 1,
  待授权: 2,
  已完成: 3
};

const pushUnique = (list: string[], value: string) => {
  if (!list.includes(value)) list.push(value);
};

/**
 * 把同一批次内（含本站当前包）各来源的工卡记录按工卡编号合并。
 * 调用前应先按飞机登记号认领；登记号不符的记录不进入本函数。
 */
export function deriveMergedCards(records: CardRecord[]): Map<string, MergedCard> {
  const byCard = new Map<string, CardRecord[]>();
  for (const record of records) {
    const list = byCard.get(record.cardId) ?? [];
    list.push(record);
    byCard.set(record.cardId, list);
  }

  const result = new Map<string, MergedCard>();
  for (const [cardId, rs] of byCard) {
    const legacy = rs.some((record) => !record.hangar || !record.hangar.trim());
    const sources: string[] = [];
    for (const record of rs) pushUnique(sources, hangarLabel(record.hangar));
    const conflicts: FieldConflict[] = [];
    const dedupe: DedupeCount = { evidence: 0, signatures: 0, releaseNotes: 0, completion: 0 };

    // —— 测量值：非空值按来源去重，出现两个及以上不同值即冲突 ——
    const measureValues = new Map<string, string[]>();
    for (const record of rs) {
      const value = (record.measurement ?? '').trim();
      if (!value) continue;
      const hangars = measureValues.get(value) ?? [];
      pushUnique(hangars, hangarLabel(record.hangar));
      measureValues.set(value, hangars);
    }
    if (measureValues.size > 1) {
      conflicts.push({
        field: 'measurement',
        fieldLabel: '测量值',
        values: [...measureValues.entries()].map(([value, hangars]) => ({ hangar: hangars.join('、'), value }))
      });
    }
    const measurement = measureValues.size === 1 ? [...measureValues.keys()][0] : undefined;

    // —— 证据：按证据编号去重（同编号即同一份附件）；同编号不同名称为冲突 ——
    const evidenceIndex = new Map<string, Set<string>>();
    let evidenceEntries = 0;
    for (const record of rs) {
      for (const file of record.evidence ?? []) {
        evidenceEntries += 1;
        const names = evidenceIndex.get(file.id) ?? new Set<string>();
        names.add(file.name);
        evidenceIndex.set(file.id, names);
      }
    }
    const evidence: EvidenceFile[] = [];
    for (const [id, names] of evidenceIndex) {
      evidence.push({ id, name: [...names][0] });
      if (names.size > 1) {
        conflicts.push({
          field: 'evidence',
          fieldLabel: `证据 ${id}`,
          values: [...names].map((name) => {
            const hangars = new Set<string>();
            for (const record of rs) {
              for (const file of record.evidence ?? []) {
                if (file.id === id && file.name === name) hangars.add(hangarLabel(record.hangar));
              }
            }
            return { hangar: [...hangars].join('、'), value: name };
          })
        });
      }
    }
    dedupe.evidence = Math.max(0, evidenceEntries - evidence.length);

    // —— 阶段签署：同阶段同人只保留一次；同阶段不同签署人即冲突 ——
    const sigIndex = new Map<string, Map<string, { time: string; hangars: string[] }>>();
    let signatureEntries = 0;
    for (const record of rs) {
      for (const sig of record.signatures ?? []) {
        signatureEntries += 1;
        const stageMap = sigIndex.get(sig.stage) ?? new Map<string, { time: string; hangars: string[] }>();
        const existing = stageMap.get(sig.actor);
        if (existing) {
          pushUnique(existing.hangars, hangarLabel(record.hangar));
        } else {
          stageMap.set(sig.actor, { time: sig.time, hangars: [hangarLabel(record.hangar)] });
        }
        sigIndex.set(sig.stage, stageMap);
      }
    }
    const signatures: SignatureValue[] = [];
    for (const [stage, actorMap] of sigIndex) {
      if (actorMap.size > 1) {
        conflicts.push({
          field: 'signature',
          fieldLabel: `${stage}阶段签署`,
          values: [...actorMap.entries()].map(([actor, info]) => ({ hangar: info.hangars.join('、'), value: `${actor} · ${info.time}` }))
        });
      } else {
        const [actor, info] = [...actorMap.entries()][0];
        signatures.push({ stage, actor, time: info.time });
      }
    }
    const distinctSigPairs = [...sigIndex.values()].reduce((sum, actorMap) => sum + actorMap.size, 0);
    dedupe.signatures = signatureEntries - distinctSigPairs;

    // —— 放行单：同编号同引用只计一次；不同放行结论即冲突 ——
    const notes = rs.flatMap((record) => (record.releaseNote ? [{ ...record.releaseNote, hangar: hangarLabel(record.hangar) }] : []));
    let releaseNote: ReleaseNote | undefined;
    if (notes.length) {
      const noteIds = new Set(notes.map((note) => note.id));
      const sameId = [...noteIds].length === 1;
      const refs = new Set(notes.map((note) => note.ref));
      dedupe.releaseNotes = notes.length - noteIds.size;
      if (!sameId || refs.size > 1) {
        conflicts.push({
          field: 'releaseNote',
          fieldLabel: '放行单',
          values: notes.map((note) => ({ hangar: note.hangar, value: `${note.id} · ${note.ref}` }))
        });
      } else {
        const note = notes[0];
        releaseNote = { id: note.id, ref: note.ref };
      }
    }

    // —— 完成数：同一工卡无论几座机库报完成，只计一次 ——
    const completedSources = rs.filter((record) => record.completed || record.status === '已完成');
    dedupe.completion = Math.max(0, completedSources.length - (completedSources.length ? 1 : 0));
    const completed = completedSources.length > 0;

    // —— 状态取最高进展 ——
    let status: CardStatus = rs[0].status;
    for (const record of rs) {
      if (statusRank[record.status] > statusRank[status]) status = record.status;
    }
    if (completed) status = '已完成';

    const findingSource = rs.find((record) => (record.finding ?? '').trim());
    const metaSource = rs.find((record) => record.title) ?? rs[0];

    result.set(cardId, {
      cardId,
      title: metaSource.title,
      zone: metaSource.zone,
      stage: metaSource.stage,
      estimated: metaSource.estimated,
      dependencies: metaSource.dependencies,
      tolerance: metaSource.tolerance,
      evidenceRequired: metaSource.evidenceRequired,
      witness: metaSource.witness,
      sources,
      legacy,
      status,
      completed,
      measurement,
      finding: findingSource?.finding,
      evidence,
      signatures,
      releaseNote,
      conflicts,
      dedupe
    });
  }
  return result;
}

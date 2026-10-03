import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Divider,
  Field,
  FluentProvider,
  Input,
  MessageBar,
  MessageBarBody,
  ProgressBar,
  Tab,
  TabList,
  Tag,
  Text,
  Textarea,
  Tooltip,
  webLightTheme
} from '@fluentui/react-components';
import {
  AlertRegular,
  ArrowDownloadRegular,
  ArrowSwapRegular,
  ArrowSyncRegular,
  BookOpenRegular,
  CheckmarkCircleRegular,
  ClipboardTaskListLtrRegular,
  CloudArrowUpRegular,
  CloudOffRegular,
  DocumentBulletListRegular,
  GaugeRegular,
  HistoryRegular,
  LockClosedRegular,
  NavigationRegular,
  PeopleRegular,
  WarningRegular
} from '@fluentui/react-icons';
import { useGetWorkPackageQuery, useListInboundBatchesQuery, useReceiveTransferMutation, useSubmitCardMutation, type InboundBatch } from './api';
import { applyTransferResult, authorizeOverride, refreshVersion, releasePackage, resolveConflict, selectCard, setConflict, setTransferError, signStage, supplementEvidence, toggleOffline, updateCard, type RootState } from './store';
import { deriveMergedCards, hangarLabel, TARGET_AIRCRAFT, type CardRecord } from './transfer';

type NavItem = { path: string; label: string; icon: ReactNode };

const signatureValid = (item: { status: string; invalidated?: boolean }) => item.status === '已签署' && !item.invalidated;

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const completed = state.cards.filter((card) => card.status === '已完成').length;
  const blockedCount = state.cards.filter((card) => card.status === '待授权' || card.status === '挂起').length;
  const nav: NavItem[] = [
    { path: '/', label: '工作包总览', icon: <ClipboardTaskListLtrRegular /> },
    { path: '/transfer', label: '转站接收', icon: <ArrowSwapRegular /> },
    { path: '/execution', label: '工卡执行', icon: <BookOpenRegular /> },
    { path: '/release', label: '放行审阅', icon: <LockClosedRegular /> },
    { path: '/audit', label: '审计与差异', icon: <HistoryRegular /> }
  ];
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon"><NavigationRegular /></div>
          <div><strong>航空定检执行台</strong><span>Maintenance Work Package</span></div>
        </div>
        <div className="aircraft-chip"><span>B-7891</span><strong>B737-800</strong><Badge appearance="tint" color="brand">48A 定检</Badge></div>
        <div className="header-spacer" />
        <button className={`sync-status ${state.offline ? 'offline' : ''}`} onClick={() => dispatch(toggleOffline())}>
          {state.offline ? <CloudOffRegular /> : <CloudArrowUpRegular />}<span>{state.offline ? '离线暂存' : `已同步 R${state.syncVersion}`}</span>
        </button>
        <div className="user-chip"><span>执行人员</span><strong>宋杰 · 机械</strong></div>
      </header>
      <div className="shell-grid">
        <aside className="side-nav">
          <div className="package-summary">
            <span>工作包</span><strong>WP-B7891-04</strong><small>上海浦东 · H3 机库</small>
            <div><ProgressBar value={completed / state.cards.length} /><span>{completed} / {state.cards.length} 工卡完成（{Math.round(completed / state.cards.length * 100)}%）</span></div>
          </div>
          <nav>{nav.map((item) => <NavLink end={item.path === '/'} key={item.path} to={item.path}>{item.icon}<span>{item.label}</span>{item.path === '/transfer' && state.cards.some((card) => card.status === '挂起') && <i className="nav-dot" />}</NavLink>)}</nav>
          <div className="side-status"><WarningRegular /><div><strong>{blockedCount} 项待处理</strong><span>挂起/待授权，放行前必须处理</span></div></div>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}

function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return <div className="page-heading"><div><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{actions}</div></div>;
}

function Overview() {
  const state = useSelector((root: RootState) => root.maintenance);
  const { data } = useGetWorkPackageQuery();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const completed = state.cards.filter((card) => card.status === '已完成').length;
  const blockers = state.cards.filter((card) => card.status === '待授权' || card.status === '挂起');
  const pendingSigs = state.signatures.filter((item) => !signatureValid(item)).length;
  return (
    <div className="page">
      <PageHeading eyebrow="WP-B7891-04 / 48A CHECK" title="工作包总览" description="监控工卡依赖、阶段签署、超差项目、转站并批和放行门禁。" actions={<><Button appearance="secondary" icon={<ArrowDownloadRegular />}>导出进度</Button><Button appearance="primary" icon={<ArrowSwapRegular />} onClick={() => navigate('/transfer')}>转站接收</Button></>} />
      {blockers.length > 0 && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>放行阻断：</strong>{blockers.map((card) => `${card.id}（${card.status}）${card.title}`).join('、')}。{state.cards.some((card) => card.status === '挂起') ? '挂起工卡请到「转站接收」选定来源值解挂。' : '待授权项等待授权人员处理。'}</MessageBarBody></MessageBar>}
      <div className="metrics-grid">
        {[
          ['工卡完成度', `${completed} / ${state.cards.length}`, `${Math.round(completed / state.cards.length * 100)}%（完成数已去重）`, 'green'],
          ['已记录工时', '18.6 h', '计划 20.5 h', 'blue'],
          ['挂起 / 待授权', String(blockers.length), `${state.cards.filter((card) => card.status === '挂起').length} 挂起 · ${state.cards.filter((card) => card.status === '待授权').length} 待授权`, 'amber'],
          ['待重算签署', String(pendingSigs), '含补交后失效待重签', 'red']
        ].map((item) => <div className="metric-card" key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small className={item[3]}>{item[2]}</small></div>)}
      </div>
      <div className="overview-grid">
        <section className="panel task-panel">
          <div className="panel-head"><div><h2>关键工卡与依赖</h2><span>按执行依赖和风险排序；来源标记显示工卡并入自哪座机库</span></div><Badge appearance="tint">{data?.revision ?? 'WP R7'}</Badge></div>
          {state.cards.map((card, index) => (
            <button key={card.id} className={`task-row ${state.activeCardId === card.id ? 'active' : ''}`} onClick={() => { dispatch(selectCard(card.id)); navigate(card.status === '挂起' ? '/transfer' : '/execution'); }}>
              <span className={`task-index ${card.status === '已完成' ? 'done' : card.status === '待授权' || card.status === '挂起' ? 'blocked' : ''}`}>{card.status === '已完成' ? <CheckmarkCircleRegular /> : index + 1}</span>
              <span className="task-main"><strong>{card.id} · {card.title}</strong><small>{card.zone} · 来源 {card.sourceHangars.join('、')}{card.legacy ? '（旧包兼容）' : ''} · 证据 {card.evidenceFiles.length} 项</small></span>
              <Tag appearance="outline" size="small">{card.stage}</Tag>
              <Badge appearance="tint" color={card.status === '已完成' ? 'success' : card.status === '待授权' || card.status === '挂起' ? 'danger' : card.status === '执行中' ? 'brand' : 'informative'}>{card.status}</Badge>
            </button>
          ))}
        </section>
        <aside className="overview-side">
          <section className="panel stage-panel"><div className="panel-head"><h2>阶段签字</h2><PeopleRegular /></div>{state.signatures.map((item) => <div className="signature-row" key={item.stage}><span className={signatureValid(item) ? 'signed' : ''}>{signatureValid(item) ? <CheckmarkCircleRegular /> : item.invalidated ? <WarningRegular /> : item.stage.slice(0, 1)}</span><div><strong>{item.stage}签署{item.invalidated ? ' · 已失效待重签' : ''}</strong><small>{item.actor} · {item.time}{item.invalidatedReason ? ` · ${item.invalidatedReason}` : ''}</small></div></div>)}</section>
          <section className="panel dependency-panel"><div className="panel-head"><h2>依赖路径</h2><GaugeRegular /></div><div className="dependency-graph"><span>CARD-01</span><i /><span>CARD-02</span><i /><span className="critical">CARD-03</span><i /><span>CARD-07</span><i /><span>CARD-08</span></div></section>
        </aside>
      </div>
    </div>
  );
}

function Execution() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { data } = useGetWorkPackageQuery();
  const card = state.cards.find((item) => item.id === state.activeCardId) ?? state.cards[0];
  const [measurement, setMeasurement] = useState(card.measurement);
  const [finding, setFinding] = useState(card.finding);
  const [consumable, setConsumable] = useState('');
  const [witness, setWitness] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [submitCard] = useSubmitCardMutation();
  useEffect(() => { setMeasurement(card.measurement); setFinding(card.finding); }, [card.id, card.measurement, card.finding]);
  const toleranceIssue = card.id === 'CARD-03' && Number.parseFloat(measurement) < 2850;
  const dependenciesMet = card.dependencies.every((dependency) => state.cards.find((item) => item.id === dependency)?.status === '已完成');
  const stageSignature = state.signatures.find((item) => item.stage === card.stage.replace(/签署$/, ''));
  const complete = async () => {
    if (card.status === '挂起') {
      dispatch(setConflict('该工卡因转站记录不一致挂起，请先到「转站接收」选定来源原值。'));
      return;
    }
    if (!dependenciesMet) {
      dispatch(setConflict(`前置工卡 ${card.dependencies.join('、')} 尚未完成。`));
      return;
    }
    if (toleranceIssue) {
      dispatch(setConflict('测量值超出容差，必须由授权人员处理。'));
      return;
    }
    if (!witness) {
      dispatch(setConflict('关键步骤必须完成见证确认。'));
      return;
    }
    if (state.syncVersion !== state.serverVersion) {
      dispatch(setConflict('检测到冲突提交：本地版本与服务器版本不一致，请刷新后重试。'));
      return;
    }
    const result = await submitCard({ cardId: card.id, expectedRevision: state.serverVersion, measurement, finding }).unwrap().catch((error) => {
      dispatch(setConflict(error.data?.message ?? '提交失败，请重试。'));
      return null;
    });
    if (result?.accepted) {
      dispatch(updateCard({ measurement, finding, status: '已完成' }));
      dispatch(setConflict(''));
    }
  };
  const addSupplementaryEvidence = () => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    dispatch(supplementEvidence({ cardId: card.id, file: { id: `EV-SUPP-${Date.now()}`, name: `补交证据_${card.id}_${time.replace(':', '')}.pdf` } }));
  };
  return (
    <div className="page">
      <PageHeading eyebrow={`${card.id} / ${card.stage}`} title={card.title} description={`${card.zone} · 工卡版本 ${data?.revision ?? 'R7'} · 来源 ${card.sourceHangars.join('、')}${card.legacy ? '（旧包兼容）' : ''} · 预计 ${card.estimated} 小时`} actions={<><Button appearance="secondary" icon={<ArrowSyncRegular />} onClick={() => dispatch(toggleOffline())}>{state.offline ? '恢复在线' : '离线暂存'}</Button><Button appearance="primary" icon={<CheckmarkCircleRegular />} onClick={complete}>{card.status === '已完成' ? '补交并保存（触发重算）' : '完成并提交'}</Button></>} />
      {card.status === '挂起' && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>工卡挂起：</strong>{card.id} 的 {card.conflict?.conflicts.map((item) => item.fieldLabel).join('、')} 在来源机库间不一致，两份原值已保留。<Button appearance="transparent" size="small" onClick={() => navigate('/transfer')}>前往解挂</Button></MessageBarBody></MessageBar>}
      {stageSignature?.invalidated && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>签字已失效：</strong>{stageSignature.stage}阶段签署因{stageSignature.invalidatedReason ?? '数据补交'}自动失效，放行结论同步重算，需在放行页重新签署。</MessageBarBody></MessageBar>}
      {state.conflictMessage && <MessageBar intent="error" className="top-message"><MessageBarBody><strong>提交被阻断：</strong>{state.conflictMessage}</MessageBarBody><Button appearance="secondary" size="small" onClick={() => dispatch(refreshVersion())}>刷新版本</Button></MessageBar>}
      <div className="execution-grid">
        <section className="panel card-editor">
          <div className="panel-head"><div><h2>工卡执行内容</h2><span>执行人员必须记录关键数据及证据；补交后签字与放行结论立即失效重算</span></div><Badge appearance="tint" color={card.status === '待授权' || card.status === '挂起' ? 'danger' : 'brand'}>{card.status}</Badge></div>
          <div className="procedure-block">
            <h3>施工步骤</h3>
            {['确认飞机断电并设置 DO NOT OPERATE 警告牌。', '连接校准合格的测试设备，按 AMM 29-10-00 执行压力保持测试。', '记录稳定压力值，检查 10 分钟内压降。', '恢复系统构型，目视检查渗漏并上传证据。'].map((step, index) => <label key={step} className="procedure-step"><Checkbox defaultChecked={index < 2} /><span><b>{index + 1}.</b> {step}</span></label>)}
          </div>
          <Divider />
          <div className="form-grid">
            <Field label="测量值" hint={card.tolerance} validationState={toleranceIssue ? 'error' : 'none'} validationMessage={toleranceIssue ? '低于最低接受值 2850 psi' : card.status === '已完成' ? '已完成工卡补交测量值后，相关签字将立即失效重算' : undefined}><Input value={measurement} onChange={(_, data) => setMeasurement(data.value)} contentBefore={<GaugeRegular />} /></Field>
            <Field label="耗材 / 航材"><Input value={consumable} onChange={(_, data) => setConsumable(data.value)} placeholder="输入件号或耗材批次" /></Field>
            <Field label="发现与处置" className="wide-field"><Textarea value={finding} onChange={(_, data) => setFinding(data.value)} resize="vertical" placeholder="正常或填写缺陷、处置措施" /></Field>
            <Field label="证据附件" className="wide-field"><div className="upload-zone"><CloudArrowUpRegular /><strong>拖入照片、测试记录或报告</strong><span>已关联 {card.evidenceFiles.length} 个证据（并批时按编号去重）· 支持 JPG / PDF / TXT</span></div></Field>
          </div>
          <label className="witness-check"><Checkbox checked={witness} onChange={(_, data) => setWitness(Boolean(data.checked))} /><span><strong>见证人已现场确认</strong><small>要求：{card.witness}</small></span></label>
        </section>
        <aside className="execution-side">
          <section className="panel card-meta"><div className="panel-head"><h2>工卡信息</h2><DocumentBulletListRegular /></div><dl><div><dt>容差</dt><dd>{card.tolerance}</dd></div><div><dt>证据要求</dt><dd>{card.evidence}</dd></div><div><dt>前置条件</dt><dd>{card.dependencies.length ? card.dependencies.join('、') : '无'}</dd></div><div><dt>来源机库</dt><dd>{card.sourceHangars.join('、')}</dd></div></dl></section>
          {card.status === '待授权' && <section className="panel override-panel"><WarningRegular /><h3>超差项目等待授权</h3><p>原始测量值已保留。授权人员可以批准工程指令、退回复测或要求停场处理。</p><Button appearance="primary" onClick={() => setOverrideOpen(true)}>授权处理</Button></section>}
          <section className="panel evidence-panel"><div className="panel-head"><h2>证据附件</h2><Button size="small" appearance="primary" onClick={addSupplementaryEvidence}>补交证据</Button></div>{card.evidenceFiles.length === 0 && <div className="evidence-empty">尚无证据附件，可从外站批次并入或现场补交。</div>}{card.evidenceFiles.map((file) => <div className="evidence-row" key={file.id}><DocumentBulletListRegular /><div><strong>{file.name}</strong><small>{file.id} · 已绑定工卡</small></div><Button size="small" appearance="subtle">预览</Button></div>)}</section>
        </aside>
      </div>
      <Dialog open={overrideOpen} onOpenChange={(_, data) => setOverrideOpen(data.open)}><DialogSurface><DialogBody><DialogTitle>超差授权处理</DialogTitle><DialogContent>批准后将在工卡中记录授权人、工程指令编号与处置依据，原始测量值不会被覆盖。<Field label="工程指令编号" required className="dialog-field"><Input defaultValue="EO-2026-1147" /></Field><Field label="授权依据" required className="dialog-field"><Textarea defaultValue="按 AMM 容差分析并经工程部门确认，允许执行复测与系统恢复。" /></Field></DialogContent><DialogActions><Button appearance="secondary" onClick={() => setOverrideOpen(false)}>取消</Button><Button appearance="primary" onClick={() => { dispatch(authorizeOverride()); setOverrideOpen(false); }}>确认授权</Button></DialogActions></DialogBody></DialogSurface></Dialog>
    </div>
  );
}

// 批次在认领前的纯前端预览：用领域合并函数预判哪些工卡会并入、哪些会挂起
function batchPreview(batch: InboundBatch) {
  const records = batch.groups.flatMap((group) => group.records).filter((record) => record.aircraft === TARGET_AIRCRAFT);
  const merged = deriveMergedCards(records);
  return { records, merged };
}

function ConflictCardList({ cards, showActions }: { cards: { id: string; sourceHangars: string[]; conflict?: { conflicts: { fieldLabel: string; values: { hangar: string; value: string }[] }[] } }[]; showActions: boolean }) {
  const dispatch = useDispatch();
  return (
    <>
      {cards.map((card) => (
        <div className="conflict-card" key={card.id}>
          <div className="conflict-head"><strong>{card.id}</strong><Badge appearance="tint" color="danger">挂起</Badge></div>
          {card.conflict?.conflicts.map((conflict, index) => (
            <div className="conflict-field" key={`${conflict.fieldLabel}-${index}`}>
              <span className="conflict-field-name">{conflict.fieldLabel}</span>
              {conflict.values.map((value) => <div className="conflict-value" key={`${value.hangar}-${value.value}`}><Tag size="extra-small">{value.hangar}</Tag><code>{value.value}</code>{showActions && <Button size="small" appearance="subtle" onClick={() => dispatch(resolveConflict({ cardId: card.id, hangar: value.hangar }))}>采纳此值解挂</Button>}</div>)}
            </div>
          ))}
          <small>来源：{card.sourceHangars.join(' / ')} · 两套原值均已保留，解挂后相关签字失效并重算</small>
        </div>
      ))}
    </>
  );
}

function TransferStation() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const { data: inbound } = useListInboundBatchesQuery();
  const [receiveTransfer, mutation] = useReceiveTransferMutation();
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [simulateFailure, setSimulateFailure] = useState(true);
  const [simultaneous, setSimultaneous] = useState(true);
  const [notice, setNotice] = useState('');

  const batches = inbound ?? [];
  const selectedId = selectedBatchId && batches.some((batch) => batch.batchId === selectedBatchId) ? selectedBatchId : batches[0]?.batchId ?? '';
  const selected = batches.find((batch) => batch.batchId === selectedId);
  const alreadyApplied = state.appliedBatches.find((batch) => batch.batchId === selectedId);
  const suspendedCards = state.cards.filter((card) => card.status === '挂起');
  const preview = selected ? batchPreview(selected) : null;

  const claim = async () => {
    if (!selected) return;
    setNotice('');
    dispatch(setTransferError(''));
    const failFirstWrite = simulateFailure && !alreadyApplied;
    try {
      if (simultaneous && selected.groups.length > 1) {
        // 两座机库同时提交同一包：同 tick 两次调用，服务端按批次号合流只成一次
        const calls = selected.groups.map((group) =>
          receiveTransfer({ batchId: selected.batchId, groups: [group], failFirstWrite }).unwrap()
        );
        const results = await Promise.all(calls);
        dispatch(applyTransferResult(results[0]));
      } else {
        const result = await receiveTransfer({ batchId: selected.batchId, groups: selected.groups, failFirstWrite }).unwrap();
        dispatch(applyTransferResult(result));
      }
      setNotice('批次已并入当前包：无冲突测量/证据/签署已合并，重复完成数与放行单已去重，不一致项已挂起。');
    } catch (error: unknown) {
      const message = (error as { data?: { message?: string } })?.data?.message ?? '接收失败，请重试。';
      // 写入失败：客户端不应用任何结果（回到接站前）；下一次重试服务端只补尚未并入的工卡
      dispatch(setTransferError(message));
      setSimulateFailure(false);
    }
  };

  return (
    <div className="page">
      <PageHeading eyebrow="TRANSFER / B-7891" title="转站接收 · 合并批次" description="按工卡编号和飞机登记号认领外站半包：无冲突测量、证据与阶段签署并入当前包；两套记录不一致则挂起并保留两份原值。旧包无来源机库标记按本站历史兼容。" />
      {state.lastTransferError && <MessageBar intent="error" className="top-message"><MessageBarBody><strong>写入失败，已回到接站前：</strong>{state.lastTransferError} 本地包未做任何改动；点击「重试接收」只补尚未并入的工卡。</MessageBarBody></MessageBar>}
      {notice && !state.lastTransferError && <MessageBar intent="success" className="top-message"><MessageBarBody>{notice}</MessageBarBody></MessageBar>}
      <div className="transfer-grid">
        <div className="transfer-main">
          <section className="panel">
            <div className="panel-head"><div><h2>待接收批次</h2><span>同一批次号只成一次；并发提交自动合流</span></div><Tag size="small">{batches.length} 个批次</Tag></div>
            {batches.map((batch) => {
              const applied = state.appliedBatches.find((item) => item.batchId === batch.batchId);
              const previewInfo = batchPreview(batch);
              const suspendedCount = [...previewInfo.merged.values()].filter((card) => card.conflicts.length).length;
              return (
                <button key={batch.batchId} className={`batch-row ${selectedId === batch.batchId ? 'active' : ''}`} onClick={() => { setSelectedBatchId(batch.batchId); setNotice(''); }}>
                  <span className="batch-icon">{applied ? <CheckmarkCircleRegular /> : <ArrowSwapRegular />}</span>
                  <span className="batch-main">
                    <strong>{batch.batchId} · {batch.fromStation}</strong>
                    <small>{batch.note}</small>
                    <small>{batch.groups.map((group) => hangarLabel(group.hangar)).join(' / ')} · 共 {previewInfo.records.length} 条认领记录 · 涉及 {previewInfo.merged.size} 张工卡{suspendedCount ? ` · 预判 ${suspendedCount} 张挂起` : ''}</small>
                  </span>
                  <Badge appearance="tint" color={applied ? 'success' : 'brand'}>{applied ? `已并批${applied.coalesced ? '（合流）' : ''}` : '待接收'}</Badge>
                </button>
              );
            })}
          </section>

          {selected && (
            <section className="panel claim-panel">
              <div className="panel-head"><div><h2>认领 {alreadyApplied ? '结果' : '操作'}</h2><span>认领键：工卡编号 + 飞机登记号（当前包 {TARGET_AIRCRAFT}）</span></div></div>
              <div className="claim-body">
                {selected.groups.map((group) => {
                  const mine = group.records.filter((record) => record.aircraft === TARGET_AIRCRAFT);
                  const foreign = group.records.filter((record) => record.aircraft !== TARGET_AIRCRAFT);
                  return (
                    <div className="hangar-block" key={`${selected.batchId}-${hangarLabel(group.hangar)}`}>
                      <div className="hangar-head"><PeopleRegular /><strong>{hangarLabel(group.hangar)}</strong><Tag size="extra-small">{group.receivedAt}</Tag></div>
                      <div className="hangar-records">
                        {mine.map((record: CardRecord) => <span className="record-chip" key={`${record.cardId}-${record.hangar}`}>{record.cardId} · {record.status}{record.measurement ? ` · ${record.measurement}` : ''}</span>)}
                        {foreign.map((record) => <span className="record-chip rejected" key={`${record.cardId}-${record.hangar}`}>{record.cardId} · 登记号 {record.aircraft} 不认领</span>)}
                      </div>
                    </div>
                  );
                })}
                {preview && (
                  <div className="preview-block">
                    <strong>合并预览（领域规则直算）</strong>
                    {[...preview.merged.values()].map((card) => (
                      <div className={`preview-row ${card.conflicts.length ? 'suspend' : 'clean'}`} key={card.cardId}>
                        <span>{card.cardId}</span>
                        {card.conflicts.length
                          ? <small>挂起：{card.conflicts.map((conflict) => conflict.fieldLabel).join('、')} 不一致，保留 {card.sources.join(' / ')} 原值</small>
                          : <small>并入：{[card.measurement && `测量 ${card.measurement}`, card.evidence.length && `证据 ${card.evidence.length} 项`, card.signatures.length && `${card.signatures.length} 个阶段签署`, card.releaseNote && '放行单 1 份'].filter(Boolean).join(' · ') || '状态更新'}；来源 {card.sources.join('、')}，完成数计 1 次</small>}
                      </div>
                    ))}
                  </div>
                )}
                {!alreadyApplied && (
                  <div className="claim-options">
                    <label><Checkbox checked={simultaneous} onChange={(_, data) => setSimultaneous(Boolean(data.checked))} label="模拟两座机库同时提交（服务端按批次号合流，只成一次）" /></label>
                    <label><Checkbox checked={simulateFailure} onChange={(_, data) => setSimulateFailure(Boolean(data.checked))} label="模拟首次写入失败（仅首卡落盘 → 回到接站前，重试只补差）" /></label>
                  </div>
                )}
                <div className="claim-actions">
                  {alreadyApplied
                    ? <Text size={200}>该批次已并入（尝试 {alreadyApplied.attempts} 次{alreadyApplied.coalesced ? '，并发已合流' : ''}），重复提交不会二次成批。</Text>
                    : <Button appearance="primary" icon={<ArrowSwapRegular />} disabled={mutation.isLoading} onClick={claim}>{state.lastTransferError ? '重试接收（只补尚未并入的工卡）' : mutation.isLoading ? '正在认领…' : '按工卡编号 + 登记号认领并合并批次'}</Button>}
                </div>
              </div>
            </section>
          )}
        </div>

        <aside className="transfer-side">
          <section className="panel">
            <div className="panel-head"><div><h2>挂起工卡</h2><span>两套记录不一致，原值双保留</span></div><Badge appearance="tint" color={suspendedCards.length ? 'danger' : 'success'}>{suspendedCards.length}</Badge></div>
            {suspendedCards.length === 0 && <div className="side-empty">暂无挂起工卡。</div>}
            <ConflictCardList cards={suspendedCards} showActions />
          </section>
          <section className="panel">
            <div className="panel-head"><div><h2>已并批次 / 认领结果</h2><span>失败整批不落，重试补剩余工卡</span></div></div>
            {state.appliedBatches.length === 0 && <div className="side-empty">尚未接收任何转站批次。</div>}
            {state.appliedBatches.map((batch) => (
              <div className="applied-batch" key={batch.batchId}>
                <strong>{batch.batchId}</strong>
                <small>{batch.time} 并批 · 尝试 {batch.attempts} 次{batch.coalesced ? ' · 两机库同时提交已合流只成一次' : ''}</small>
                <small>并入工卡 {batch.mergedCardIds.length} 张：{batch.mergedCardIds.join('、')}</small>
                {batch.unclaimed.length > 0 && <small className="rejected-text">未认领（登记号不符）：{batch.unclaimed.map((item) => `${item.cardId}@${item.aircraft}`).join('、')}</small>}
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Release() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const [tab, setTab] = useState('open');
  const blockers = state.cards.filter((card) => card.status !== '已完成' && card.status !== '未开始');
  const allSigned = state.signatures.every((item) => signatureValid(item));
  const signedCount = state.signatures.filter((item) => signatureValid(item)).length;
  return (
    <div className="page">
      <PageHeading eyebrow="RELEASE REVIEW / B-7891" title="放行审阅" description="核对未关闭项目、重复缺陷、关键证据与阶段签字；补交数据后签字与放行结论自动失效重算。" actions={<Button appearance="primary" icon={<LockClosedRegular />} disabled={!allSigned || blockers.some((card) => card.status === '待授权' || card.status === '挂起')} onClick={() => dispatch(releasePackage())}>{state.released ? '工作包已锁定' : '锁定并放行'}</Button>} />
      {state.released && <MessageBar intent="success" className="top-message"><MessageBarBody>工作包已锁定，形成只读放行基线并纳入审计记录。</MessageBarBody></MessageBar>}
      {!state.released && state.signatures.some((item) => item.invalidated) && <MessageBar intent="warning" className="top-message"><MessageBarBody>测量/证据补交或挂起解挂后，相关阶段签字与原放行结论已立即失效，请重算后重新签署。</MessageBarBody></MessageBar>}
      <div className="release-grid">
        <section className="panel release-main">
          <TabList selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}><Tab value="open">未关闭项目 <Badge>{blockers.length}</Badge></Tab><Tab value="repeat">重复缺陷 <Badge>2</Badge></Tab><Tab value="evidence">关键证据 <Badge>{state.cards.reduce((sum, card) => sum + card.evidenceFiles.length, 0)}</Badge></Tab></TabList>
          <div className="tab-body">
            {tab === 'open' && blockers.map((card) => <div className="review-item" key={card.id}><span className={`risk-icon ${card.status === '待授权' || card.status === '挂起' ? 'danger' : ''}`}><AlertRegular /></span><div><strong>{card.id} · {card.title}</strong><p>{card.status === '挂起' ? `转站记录不一致挂起：${card.conflict?.conflicts.map((conflict) => conflict.fieldLabel).join('、')} 两套原值已保留` : card.finding || '工卡正在执行，完成后需由放行人员复核。'}</p><small>{card.zone} · 来源 {card.sourceHangars.join('、')} · 要求证据 {card.evidence}</small></div><Badge appearance="tint" color={card.status === '待授权' || card.status === '挂起' ? 'danger' : 'warning'}>{card.status}</Badge></div>)}
            {tab === 'repeat' && <><div className="review-item"><span className="risk-icon danger"><HistoryRegular /></span><div><strong>液压系统压力偏低 · 第 3 次记录</strong><p>2026-08-16、09-02、09-29 均在系统 A 出现压力低于目标值；两座机库转来复测值不一致已挂起。</p><small>建议移交可靠性分析，并关联历史排故记录。</small></div><Badge appearance="tint" color="danger">关键</Badge></div><div className="review-item"><span className="risk-icon"><HistoryRegular /></span><div><strong>APU 启动时间延长</strong><p>最近两次航线记录均略高于机队均值。</p><small>非放行阻塞项，建议后续监控。</small></div><Badge appearance="tint" color="warning">观察</Badge></div></>}
            {tab === 'evidence' && <div className="evidence-grid">{state.cards.flatMap((card) => card.evidenceFiles.map((file) => ({ card: card.id, ...file }))).map((file) => <div className="evidence-tile" key={file.id}><DocumentBulletListRegular /><strong>{file.name}</strong><span>{file.card} · {file.id} · 已核验</span></div>)}</div>}
          </div>
        </section>
        <aside className="release-side">
          <section className="panel signoff-card"><div className="panel-head"><h2>分阶段签字</h2><span>{signedCount} / {state.signatures.length} 有效</span></div>{state.signatures.map((item) => <div className="signoff-row" key={item.stage}><div><span>{item.stage}{item.invalidated ? '（已失效）' : ''}</span><strong>{item.actor}</strong><small>{item.time}{item.invalidatedReason ? ` · ${item.invalidatedReason}` : ''}</small></div>{signatureValid(item) ? <Badge appearance="tint" color="success">已签署</Badge> : <Button size="small" appearance="primary" onClick={() => dispatch(signStage(item.stage))}>{item.invalidated ? '重算重签' : '签署'}</Button>}</div>)}</section>
          <section className="panel release-gate-card"><LockClosedRegular /><h3>放行门禁（实时重算）</h3><label><Checkbox checked={!blockers.some((card) => card.status === '待授权')} readOnly /> 无待授权超差项目</label><label><Checkbox checked={!state.cards.some((card) => card.status === '挂起')} readOnly /> 无转站冲突挂起工卡</label><label><Checkbox checked={state.cards.filter((card) => card.status === '已完成').length >= 6} readOnly /> 关键工卡完成率 ≥ 75%（完成数已去重）</label><label><Checkbox checked={allSigned} readOnly /> 全部阶段签署有效（补交后无失效签字）</label><label><Checkbox checked /> 审计记录和证据附件完整</label></section>
        </aside>
      </div>
    </div>
  );
}

function Audit() {
  const state = useSelector((root: RootState) => root.maintenance);
  const downloadAudit = () => {
    const csv = ['时间,操作者,动作,说明', ...state.audit.map((item) => [item.time, item.actor, item.action, item.detail].join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'B7891-48A-audit.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const diffs = useMemo(() => [
    { card: 'CARD-03', field: '容差', from: '≥ 2800 psi / 10 min', to: '≥ 2850 psi / 10 min', reason: 'AMM 临时修订 TR-114' },
    { card: 'CARD-07', field: '依赖', from: 'CARD-02', to: 'CARD-03', reason: '试车前置条件调整' },
    { card: 'CARD-08', field: '证据', from: '近 2 次记录', to: '近 3 次记录', reason: '可靠性复核要求' }
  ], []);
  return (
    <div className="page">
      <PageHeading eyebrow="AUDIT / VERSION CONTROL" title="审计与版本差异" description="对比工卡版本、查看操作历史（含转站并批、挂起、失效重算）并导出闭环证据。" actions={<Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={downloadAudit}>导出审计记录</Button>} />
      <div className="audit-grid">
        <section className="panel diff-panel"><div className="panel-head"><div><h2>工卡版本差异</h2><span>R6 → R7 · 3 处变更</span></div><select><option>R7</option><option>R6</option><option>R5</option></select></div><div className="diff-table"><div className="diff-head"><span>工卡</span><span>字段</span><span>原值</span><span>新值 / 原因</span></div>{diffs.map((diff) => <div className="diff-row" key={`${diff.card}-${diff.field}`}><strong>{diff.card}</strong><span>{diff.field}</span><del>{diff.from}</del><div><ins>{diff.to}</ins><small>{diff.reason}</small></div></div>)}</div></section>
        <section className="panel audit-panel"><div className="panel-head"><div><h2>完整审计时间线</h2><span>{state.audit.length} 条记录</span></div><HistoryRegular /></div>{state.audit.map((item, index) => <div className="audit-row" key={`${item.time}-${index}`}><span className="timeline-dot" /><div><strong>{item.action}</strong><p>{item.detail}</p><small>{item.time} · {item.actor}</small></div></div>)}</section>
      </div>
    </div>
  );
}

function NotFound() {
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <FluentProvider theme={webLightTheme}>
      <BrowserRouter>
        <Shell><Routes><Route path="/" element={<Overview />} /><Route path="/transfer" element={<TransferStation />} /><Route path="/execution" element={<Execution />} /><Route path="/release" element={<Release />} /><Route path="/audit" element={<Audit />} /><Route path="*" element={<NotFound />} /></Routes></Shell>
      </BrowserRouter>
    </FluentProvider>
  );
}

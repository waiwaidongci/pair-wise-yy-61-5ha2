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
import { useGetWorkPackageQuery, useSubmitCardMutation, useReceiveBatchMutation } from './api';
import { authorizeOverride, refreshVersion, releasePackage, selectCard, setConflict, signStage, supplementConflict, toggleOffline, updateCard, applyReception, type RootState } from './store';
import type { ReceptionOutcome, TransferBatch } from './transfer';

type NavItem = { path: string; label: string; icon: ReactNode };

function Shell({ children }: { children: ReactNode }) {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const nav: NavItem[] = [
    { path: '/', label: '工作包总览', icon: <ClipboardTaskListLtrRegular /> },
    { path: '/execution', label: '工卡执行', icon: <BookOpenRegular /> },
    { path: '/transfer', label: '转站接收', icon: <ArrowSyncRegular /> },
    { path: '/release', label: '放行审阅', icon: <LockClosedRegular /> },
    { path: '/audit', label: '审计与差异', icon: <HistoryRegular /> }
  ];
  const pendingTransfers = state.transferBatches.filter((batch) => batch.status === '待接收' || batch.status === '写入失败').length;
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
            <div><ProgressBar value={0.58} /><span>58% 工卡完成</span></div>
          </div>
          <nav>{nav.map((item) => <NavLink end={item.path === '/'} key={item.path} to={item.path}>{item.icon}<span>{item.label}</span>{item.path === '/transfer' && pendingTransfers > 0 && <Badge appearance="filled" color="danger" size="small">{pendingTransfers}</Badge>}</NavLink>)}</nav>
          <div className="side-status"><WarningRegular /><div><strong>{state.cards.filter((card) => card.status === '待授权').length} 项待授权</strong><span>放行前必须处理</span></div></div>
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
  const blockers = state.cards.filter((card) => card.status === '待授权');
  return (
    <div className="page">
      <PageHeading eyebrow="WP-B7891-04 / 48A CHECK" title="工作包总览" description="监控工卡依赖、阶段签署、超差项目和放行门禁。" actions={<><Button appearance="secondary" icon={<ArrowDownloadRegular />}>导出进度</Button><Button appearance="primary" icon={<NavigationRegular />} onClick={() => navigate('/execution')}>继续执行</Button></>} />
      {blockers.length > 0 && <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>放行阻断：</strong>{blockers.map((card) => `${card.id} ${card.title}`).join('、')} 等待授权人员处理。</MessageBarBody></MessageBar>}
      <div className="metrics-grid">
        {[
          ['工卡完成度', `${completed} / ${state.cards.length}`, `${Math.round(completed / state.cards.length * 100)}%`, 'green'],
          ['已记录工时', '18.6 h', '计划 20.5 h', 'blue'],
          ['开放发现', String(state.cards.filter((card) => card.finding && card.status !== '已完成').length), '1 项重复缺陷', 'amber'],
          ['待签署阶段', String(state.signatures.filter((item) => item.status === '待签署').length), '放行前完成', 'red']
        ].map((item) => <div className="metric-card" key={item[0]}><span>{item[0]}</span><strong>{item[1]}</strong><small className={item[3]}>{item[2]}</small></div>)}
      </div>
      <div className="overview-grid">
        <section className="panel task-panel">
          <div className="panel-head"><div><h2>关键工卡与依赖</h2><span>按执行依赖和风险排序</span></div><Badge appearance="tint">{data?.revision ?? 'WP R7'}</Badge></div>
          {state.cards.map((card, index) => (
            <button key={card.id} className={`task-row ${state.activeCardId === card.id ? 'active' : ''}`} onClick={() => { dispatch(selectCard(card.id)); navigate('/execution'); }}>
              <span className={`task-index ${card.status === '已完成' ? 'done' : card.status === '待授权' ? 'blocked' : ''}`}>{card.status === '已完成' ? <CheckmarkCircleRegular /> : index + 1}</span>
              <span className="task-main"><strong>{card.id} · {card.title}</strong><small>{card.zone} · 依赖 {card.dependencies.length ? card.dependencies.join('、') : '无'} · 计划 {card.estimated}h</small></span>
              <Tag appearance="outline" size="small">{card.stage}</Tag>
              <Badge appearance="tint" color={card.status === '已完成' ? 'success' : card.status === '待授权' ? 'danger' : card.status === '执行中' ? 'brand' : 'informative'}>{card.status}</Badge>
            </button>
          ))}
        </section>
        <aside className="overview-side">
          <section className="panel stage-panel"><div className="panel-head"><h2>阶段签字</h2><PeopleRegular /></div>{state.signatures.map((item) => <div className="signature-row" key={item.stage}><span className={item.status === '已签署' ? 'signed' : ''}>{item.status === '已签署' ? <CheckmarkCircleRegular /> : item.stage.slice(0, 1)}</span><div><strong>{item.stage}签署</strong><small>{item.actor} · {item.time}</small></div></div>)}</section>
          <section className="panel dependency-panel"><div className="panel-head"><h2>依赖路径</h2><GaugeRegular /></div><div className="dependency-graph"><span>CARD-01</span><i /><span>CARD-02</span><i /><span className="critical">CARD-03</span><i /><span>CARD-07</span><i /><span>CARD-08</span></div></section>
        </aside>
      </div>
    </div>
  );
}

function Execution() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
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
  const complete = async () => {
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
  return (
    <div className="page">
      <PageHeading eyebrow={`${card.id} / ${card.stage}`} title={card.title} description={`${card.zone} · 工卡版本 ${data?.revision ?? 'R7'} · 预计 ${card.estimated} 小时`} actions={<><Button appearance="secondary" icon={<ArrowSyncRegular />} onClick={() => dispatch(toggleOffline())}>{state.offline ? '恢复在线' : '离线暂存'}</Button><Button appearance="primary" icon={<CheckmarkCircleRegular />} onClick={complete}>完成并提交</Button></>} />
      {state.conflictMessage && <MessageBar intent="error" className="top-message"><MessageBarBody><strong>提交被阻断：</strong>{state.conflictMessage}</MessageBarBody><Button appearance="secondary" size="small" onClick={() => dispatch(refreshVersion())}>刷新版本</Button></MessageBar>}
      <div className="execution-grid">
        <section className="panel card-editor">
          <div className="panel-head"><div><h2>工卡执行内容</h2><span>执行人员必须记录关键数据及证据</span></div><Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'brand'}>{card.status}</Badge></div>
          <div className="procedure-block">
            <h3>施工步骤</h3>
            {['确认飞机断电并设置 DO NOT OPERATE 警告牌。', '连接校准合格的测试设备，按 AMM 29-10-00 执行压力保持测试。', '记录稳定压力值，检查 10 分钟内压降。', '恢复系统构型，目视检查渗漏并上传证据。'].map((step, index) => <label key={step} className="procedure-step"><Checkbox defaultChecked={index < 2} /><span><b>{index + 1}.</b> {step}</span></label>)}
          </div>
          <Divider />
          <div className="form-grid">
            <Field label="测量值" hint={card.tolerance} validationState={toleranceIssue ? 'error' : 'none'} validationMessage={toleranceIssue ? '低于最低接受值 2850 psi' : undefined}><Input value={measurement} onChange={(_, data) => setMeasurement(data.value)} contentBefore={<GaugeRegular />} /></Field>
            <Field label="耗材 / 航材"><Input value={consumable} onChange={(_, data) => setConsumable(data.value)} placeholder="输入件号或耗材批次" /></Field>
            <Field label="发现与处置" className="wide-field"><Textarea value={finding} onChange={(_, data) => setFinding(data.value)} resize="vertical" placeholder="正常或填写缺陷、处置措施" /></Field>
            <Field label="证据附件" className="wide-field"><div className="upload-zone"><CloudArrowUpRegular /><strong>拖入照片、测试记录或报告</strong><span>已关联 3 个证据 · 支持 JPG / PDF / TXT</span></div></Field>
          </div>
          <label className="witness-check"><Checkbox checked={witness} onChange={(_, data) => setWitness(Boolean(data.checked))} /><span><strong>见证人已现场确认</strong><small>要求：{card.witness}</small></span></label>
        </section>
        <aside className="execution-side">
          <section className="panel card-meta"><div className="panel-head"><h2>工卡信息</h2><DocumentBulletListRegular /></div><dl><div><dt>容差</dt><dd>{card.tolerance}</dd></div><div><dt>证据要求</dt><dd>{card.evidence}</dd></div><div><dt>前置条件</dt><dd>{card.dependencies.length ? card.dependencies.join('、') : '无'}</dd></div><div><dt>阶段签署</dt><dd>{card.stage}</dd></div></dl></section>
          {card.status === '待授权' && <section className="panel override-panel"><WarningRegular /><h3>超差项目等待授权</h3><p>原始测量值已保留。授权人员可以批准工程指令、退回复测或要求停场处理。</p><Button appearance="primary" onClick={() => setOverrideOpen(true)}>授权处理</Button></section>}
          <section className="panel evidence-panel"><div className="panel-head"><h2>证据附件</h2><Badge appearance="tint">3 项</Badge></div>{['IMG_20260929_0904.jpg', '液压测试原始记录.pdf', '见证签字单_宋杰.pdf'].map((file, index) => <div className="evidence-row" key={file}><DocumentBulletListRegular /><div><strong>{file}</strong><small>{index + 1}.8 MB · 09:1{index}</small></div><Button size="small" appearance="subtle">预览</Button></div>)}</section>
        </aside>
      </div>
      <Dialog open={overrideOpen} onOpenChange={(_, data) => setOverrideOpen(data.open)}><DialogSurface><DialogBody><DialogTitle>超差授权处理</DialogTitle><DialogContent>批准后将在工卡中记录授权人、工程指令编号与处置依据，原始测量值不会被覆盖。<Field label="工程指令编号" required className="dialog-field"><Input defaultValue="EO-2026-1147" /></Field><Field label="授权依据" required className="dialog-field"><Textarea defaultValue="按 AMM 容差分析并经工程部门确认，允许执行复测与系统恢复。" /></Field></DialogContent><DialogActions><Button appearance="secondary" onClick={() => setOverrideOpen(false)}>取消</Button><Button appearance="primary" onClick={() => { dispatch(authorizeOverride()); setOverrideOpen(false); }}>确认授权</Button></DialogActions></DialogBody></DialogSurface></Dialog>
    </div>
  );
}

function Release() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const [tab, setTab] = useState('open');
  const blockers = state.cards.filter((card) => card.status !== '已完成' && card.status !== '未开始');
  const allSigned = state.signatures.every((item) => item.status === '已签署');
  return (
    <div className="page">
      <PageHeading eyebrow="RELEASE REVIEW / B-7891" title="放行审阅" description="核对未关闭项目、重复缺陷、关键证据与阶段签字。" actions={<Button appearance="primary" icon={<LockClosedRegular />} disabled={!allSigned || blockers.some((card) => card.status === '待授权')} onClick={() => dispatch(releasePackage())}>{state.released ? '工作包已锁定' : '锁定并放行'}</Button>} />
      {state.released && <MessageBar intent="success" className="top-message"><MessageBarBody>工作包已锁定，形成只读放行基线并纳入审计记录。</MessageBarBody></MessageBar>}
      <div className="release-grid">
        <section className="panel release-main">
          <TabList selectedValue={tab} onTabSelect={(_, data) => setTab(String(data.value))}><Tab value="open">未关闭项目 <Badge>{blockers.length}</Badge></Tab><Tab value="repeat">重复缺陷 <Badge>2</Badge></Tab><Tab value="evidence">关键证据 <Badge>12</Badge></Tab></TabList>
          <div className="tab-body">
            {tab === 'open' && blockers.map((card) => <div className="review-item" key={card.id}><span className={`risk-icon ${card.status === '待授权' ? 'danger' : ''}`}><AlertRegular /></span><div><strong>{card.id} · {card.title}</strong><p>{card.finding || '工卡正在执行，完成后需由放行人员复核。'}</p><small>{card.zone} · 负责人 宋杰 · 要求证据 {card.evidence}</small></div><Badge appearance="tint" color={card.status === '待授权' ? 'danger' : 'warning'}>{card.status}</Badge></div>)}
            {tab === 'repeat' && <><div className="review-item"><span className="risk-icon danger"><HistoryRegular /></span><div><strong>液压系统压力偏低 · 第 3 次记录</strong><p>2026-08-16、09-02、09-29 均在系统 A 出现压力低于目标值。</p><small>建议移交可靠性分析，并关联历史排故记录。</small></div><Badge appearance="tint" color="danger">关键</Badge></div><div className="review-item"><span className="risk-icon"><HistoryRegular /></span><div><strong>APU 启动时间延长</strong><p>最近两次航线记录均略高于机队均值。</p><small>非放行阻塞项，建议后续监控。</small></div><Badge appearance="tint" color="warning">观察</Badge></div></>}
            {tab === 'evidence' && <div className="evidence-grid">{['液压系统测试记录.pdf', '发动机孔探照片_01.jpg', 'AD 执行签署页.pdf', '时寿件履历截图.png', '超差工程指令.pdf', '见证人签字单.pdf'].map((file) => <div className="evidence-tile" key={file}><DocumentBulletListRegular /><strong>{file}</strong><span>已绑定工卡 · 已核验</span></div>)}</div>}
          </div>
        </section>
        <aside className="release-side">
          <section className="panel signoff-card"><div className="panel-head"><h2>分阶段签字</h2><span>{state.signatures.filter((item) => item.status === '已签署').length} / {state.signatures.length}</span></div>{state.signatures.map((item) => <div className="signoff-row" key={item.stage}><div><span>{item.stage}</span><strong>{item.actor}</strong><small>{item.time}</small></div>{item.status === '已签署' ? <Badge appearance="tint" color="success">已签署</Badge> : <Button size="small" appearance="primary" onClick={() => dispatch(signStage(item.stage))}>签署</Button>}</div>)}</section>
          <section className="panel release-gate-card"><LockClosedRegular /><h3>放行门禁</h3><label><Checkbox checked={!blockers.some((card) => card.status === '待授权')} readOnly /> 无待授权超差项目</label><label><Checkbox checked={state.cards.filter((card) => card.status === '已完成').length >= 6} readOnly /> 关键工卡完成率 ≥ 75%</label><label><Checkbox checked={allSigned} readOnly /> 所有阶段均完成电子签署</label><label><Checkbox checked /> 审计记录和证据附件完整</label></section>
        </aside>
      </div>
    </div>
  );
}

function Audit() {
  const state = useSelector((root: RootState) => root.maintenance);
  const [selected, setSelected] = useState('R7');
  const downloadAudit = () => {
    const csv = ['时间,操作者,动作,说明', ...state.audit.map((item) => [item.time, item.actor, item.action, item.detail].join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
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
      <PageHeading eyebrow="AUDIT / VERSION CONTROL" title="审计与版本差异" description="对比工卡版本、查看操作历史并导出闭环证据。" actions={<Button appearance="primary" icon={<ArrowDownloadRegular />} onClick={downloadAudit}>导出审计记录</Button>} />
      <div className="audit-grid">
        <section className="panel diff-panel"><div className="panel-head"><div><h2>工卡版本差异</h2><span>R6 → R7 · 3 处变更</span></div><select value={selected} onChange={(event) => setSelected(event.target.value)}><option>R7</option><option>R6</option><option>R5</option></select></div><div className="diff-table"><div className="diff-head"><span>工卡</span><span>字段</span><span>原值</span><span>新值 / 原因</span></div>{diffs.map((diff) => <div className="diff-row" key={`${diff.card}-${diff.field}`}><strong>{diff.card}</strong><span>{diff.field}</span><del>{diff.from}</del><div><ins>{diff.to}</ins><small>{diff.reason}</small></div></div>)}</div></section>
        <section className="panel audit-panel"><div className="panel-head"><div><h2>完整审计时间线</h2><span>{state.audit.length} 条记录</span></div><HistoryRegular /></div>{state.audit.map((item, index) => <div className="audit-row" key={`${item.time}-${index}`}><span className="timeline-dot" /><div><strong>{item.action}</strong><p>{item.detail}</p><small>{item.time} · {item.actor}</small></div></div>)}</section>
      </div>
    </div>
  );
}

function TransferReception() {
  const state = useSelector((root: RootState) => root.maintenance);
  const dispatch = useDispatch();
  const [receiveBatch, { isLoading }] = useReceiveBatchMutation();
  const [lastResult, setLastResult] = useState<{ batchNo: string; merged: number; conflicts: number; rejected: number; evidenceAdded: number; signatureMerges: number; failed: boolean; message: string } | null>(null);
  const [supplementFor, setSupplementFor] = useState<string | null>(null);
  const [suppMeasurement, setSuppMeasurement] = useState('');
  const [suppEvidence, setSuppEvidence] = useState('');

  const pendingConflicts = state.conflicts.filter((item) => item.status === '挂起');
  const resolvedConflicts = state.conflicts.filter((item) => item.status === '已补交');
  const invalidatedStages = state.signatures.filter((item) => item.status === '待签署').length;

  const handleReceive = async (batch: TransferBatch) => {
    const result = await receiveBatch({ batch, cards: state.cards, signatures: state.signatures, processedBatchNos: state.processedBatchNos });
    if ('data' in result && result.data) {
      const outcome = result.data.outcome;
      dispatch(applyReception({ outcome, commit: true }));
      setLastResult({ batchNo: outcome.batchNo, merged: outcome.changes.length, conflicts: outcome.conflicts.length, rejected: outcome.rejected.length, evidenceAdded: outcome.evidenceAdded, signatureMerges: outcome.signatureMerges.length, failed: false, message: '' });
    } else if ('error' in result && result.error) {
      const error = result.error as { data?: { message?: string; partial?: ReceptionOutcome } };
      if (error.data?.partial) dispatch(applyReception({ outcome: error.data.partial, commit: false }));
      setLastResult({ batchNo: batch.batchNo, merged: error.data?.partial?.changes.length ?? 0, conflicts: 0, rejected: 0, evidenceAdded: 0, signatureMerges: 0, failed: true, message: error.data?.message ?? '写入失败，请重试。' });
    }
  };

  const openSupplement = (cardId: string) => {
    const conflict = state.conflicts.find((item) => item.cardId === cardId);
    setSupplementFor(cardId);
    setSuppMeasurement(conflict?.incomingValue ?? '');
    setSuppEvidence('');
  };

  const submitSupplement = () => {
    if (!supplementFor) return;
    const evidenceFiles = suppEvidence.split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
    dispatch(supplementConflict({ cardId: supplementFor, measurement: suppMeasurement.trim(), evidenceFiles }));
    setSupplementFor(null);
  };

  return (
    <div className="page">
      <PageHeading eyebrow="TRANSFER RECEPTION / MERGE BATCH" title="转站接收" description="按批次号认领外站工卡，无冲突数据并入当前包，冲突挂起并保留两份原值。" />
      <MessageBar intent="info" className="top-message"><MessageBarBody><strong>合并规则：</strong>按工卡编号 + 飞机登记号认领；测量、证据、阶段签署无冲突并入当前包；两套记录不一致则挂起并保留两份原值；补交测量或证据后，相关签字与放行结论立即失效并重算；同一批次号只成一次；写入失败回到接站前，重试只补尚未并入的工卡。</MessageBarBody></MessageBar>

      {lastResult && !lastResult.failed && (
        <MessageBar intent="success" className="top-message"><MessageBarBody><strong>批次 {lastResult.batchNo} 接收完成：</strong>并入 {lastResult.merged} 项工卡、证据 {lastResult.evidenceAdded} 份、阶段签署 {lastResult.signatureMerges} 项；挂起 {lastResult.conflicts} 项（保留两份原值）；认领失败 {lastResult.rejected} 项。完成数与放行单按合并后的当前包重算，不重复计数。</MessageBarBody></MessageBar>
      )}
      {lastResult?.failed && (
        <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>批次 {lastResult.batchNo} 写入失败：</strong>{lastResult.message}本次已并入 {lastResult.merged} 项，其余工卡未并入；点击「重试接收」只补尚未并入的工卡。</MessageBarBody></MessageBar>
      )}
      {!state.released && state.cards.some((card) => card.measurement || card.evidenceFiles?.length) && (
        <MessageBar intent="warning" className="top-message"><MessageBarBody><strong>放行结论待重算：</strong>转站数据并入或补交后，{invalidatedStages} 个阶段签字处于待签署状态，工作包需重新签署并锁定放行。</MessageBarBody></MessageBar>
      )}

      <section className="panel batch-panel">
        <div className="panel-head"><div><h2>转入批次</h2><span>同一批次号重复提交只成一次</span></div><Badge appearance="tint">{state.transferBatches.length} 批</Badge></div>
        {state.transferBatches.map((batch) => {
          const processed = batch.mergedCardIds.length;
          const total = batch.cards.length;
          const statusColor = batch.status === '已接收' ? 'success' : batch.status === '写入失败' ? 'danger' : 'informative';
          const statusLabel = batch.status === '已接收' ? '已接收' : batch.status === '写入失败' ? '写入失败 · 可重试' : '待接收';
          return (
            <div className="batch-row" key={batch.batchNo}>
              <div className="batch-main">
                <div className="batch-title"><strong>{batch.batchNo}</strong>{batch.sourceHangar ? <Badge appearance="tint" color="brand">{batch.sourceHangar}</Badge> : <Badge appearance="tint" color="success">本站历史 · 无来源标记</Badge>}<Badge appearance="outline">{batch.aircraft}</Badge></div>
                <small>{batch.packageId} · 转入 {batch.receivedAt} · 共 {total} 项工卡 · 已并入 {processed} 项{batch.attempts > 0 ? ` · 第 ${batch.attempts} 次接收` : ''}</small>
                <div className="batch-progress"><ProgressBar value={total ? processed / total : 0} /><span>{processed} / {total}</span></div>
              </div>
              <div className="batch-actions">
                <Badge appearance="filled" color={statusColor}>{statusLabel}</Badge>
                <Button appearance={batch.status === '写入失败' ? 'primary' : 'secondary'} size="small" disabled={isLoading || batch.status === '已接收'} onClick={() => handleReceive(batch)}>{batch.status === '写入失败' ? '重试接收' : '接收合并'}</Button>
              </div>
            </div>
          );
        })}
      </section>

      <div className="transfer-grid">
        <section className="panel">
          <div className="panel-head"><div><h2>挂起冲突</h2><span>两套记录不一致，保留两份原值</span></div><Badge appearance="tint" color="danger">{pendingConflicts.length}</Badge></div>
          {pendingConflicts.length === 0 && <div className="empty-hint">无挂起冲突。两套记录一致的测量、证据与阶段签署已并入当前包。</div>}
          {pendingConflicts.map((conflict) => {
            const card = state.cards.find((item) => item.id === conflict.cardId);
            return (
              <div className="conflict-row" key={conflict.cardId}>
                <div className="conflict-head"><strong>{conflict.cardId}</strong><span>{card?.title}</span></div>
                <div className="conflict-values">
                  <div className="conflict-value local"><span>本站原值</span><code>{conflict.localValue || '（空）'}</code></div>
                  <div className="conflict-value incoming"><span>外站值</span><code>{conflict.incomingValue || '（空）'}</code></div>
                </div>
                <div className="conflict-foot"><small>阶段「{card?.stage}」签字与放行结论将在补交后失效重算</small><Button size="small" appearance="primary" onClick={() => openSupplement(conflict.cardId)}>补交并重算</Button></div>
              </div>
            );
          })}
        </section>

        <aside className="transfer-side">
          <section className="panel">
            <div className="panel-head"><div><h2>已补交重算</h2><span>签字与放行已失效</span></div><Badge appearance="tint" color="success">{resolvedConflicts.length}</Badge></div>
            {resolvedConflicts.length === 0 && <div className="empty-hint">补交测量或证据后，相关阶段签字立即失效并回到待签署，放行结论需重新锁定。</div>}
            {resolvedConflicts.map((conflict) => (
              <div className="resolved-row" key={conflict.cardId}><strong>{conflict.cardId}</strong><div><span>采用值</span><code>{conflict.resolvedValue}</code></div><small>阶段签字已失效 · 放行待重算</small></div>
            ))}
          </section>
          <section className="panel">
            <div className="panel-head"><div><h2>当前包合并状态</h2></div></div>
            <dl className="merge-stats">
              <div><dt>工卡完成</dt><dd>{state.cards.filter((card) => card.status === '已完成').length} / {state.cards.length}</dd></div>
              <div><dt>证据附件</dt><dd>{state.cards.reduce((sum, card) => sum + (card.evidenceFiles?.length ?? 0), 0)} 份</dd></div>
              <div><dt>待签署阶段</dt><dd>{state.signatures.filter((item) => item.status === '待签署').length} / {state.signatures.length}</dd></div>
              <div><dt>放行基线</dt><dd>{state.released ? '已锁定' : '未锁定 · 待重算'}</dd></div>
            </dl>
          </section>
        </aside>
      </div>

      <Dialog open={supplementFor !== null} onOpenChange={(_, data) => { if (!data.open) setSupplementFor(null); }}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>补交测量与证据 · {supplementFor}</DialogTitle>
            <DialogContent>
              <MessageBar intent="warning"><MessageBarBody>补交后，该工卡相关阶段签字立即失效（回到待签署），放行结论同步失效并按当前包重新计算。</MessageBarBody></MessageBar>
              <Field label="补交测量值" required className="dialog-field"><Input value={suppMeasurement} onChange={(_, data) => setSuppMeasurement(data.value)} contentBefore={<GaugeRegular />} /></Field>
              <Field label="补交证据附件" hint="多个文件以逗号分隔" className="dialog-field"><Input value={suppEvidence} onChange={(_, data) => setSuppEvidence(data.value)} placeholder="例如：压力复测报告.pdf, 见证签字单.jpg" /></Field>
            </DialogContent>
          </DialogBody>
          <DialogActions>
            <Button appearance="secondary" onClick={() => setSupplementFor(null)}>取消</Button>
            <Button appearance="primary" onClick={submitSupplement} disabled={!suppMeasurement.trim()}>确认补交并重算</Button>
          </DialogActions>
        </DialogSurface>
      </Dialog>
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
        <Shell><Routes><Route path="/" element={<Overview />} /><Route path="/execution" element={<Execution />} /><Route path="/transfer" element={<TransferReception />} /><Route path="/release" element={<Release />} /><Route path="/audit" element={<Audit />} /><Route path="*" element={<NotFound />} /></Routes></Shell>
      </BrowserRouter>
    </FluentProvider>
  );
}

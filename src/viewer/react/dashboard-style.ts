export const DASHBOARD_STYLE = `
  :root {
    --boj-text-main: #333;
    --boj-text-muted: #555;
    --boj-text-subtle: #777;
    --boj-link: #0076c0;
    --boj-border: #ddd;
    --boj-panel: #fff;
    --boj-soft-bg: #fafafa;
  }
  body {
    background: #fff;
    color: var(--boj-text-main);
  }
  a, a:hover, a:focus, a:active {
    color: var(--boj-link);
  }
  p, li, th, td, blockquote, .dashboard-subtitle, .dashboard-note, .dashboard-empty {
    color: var(--boj-text-muted);
  }
  .dashboard-nav .navbar-nav > li > a {
    padding-left: 14px;
    padding-right: 14px;
  }
  .dashboard-nav-note {
    margin-left: 10px;
    font-size: 12px;
    color: var(--boj-text-subtle);
  }
  .dashboard-page-header {
    margin-bottom: 20px;
  }
  .dashboard-page-header h1 {
    margin-bottom: 8px;
  }
  .dashboard-subtitle {
    display: block;
    margin-bottom: 12px;
  }
  .dashboard-section-gap {
    margin-bottom: 20px;
  }
  .dashboard-form .form-group {
    margin-bottom: 14px;
  }
  .dashboard-form label {
    display: block;
    margin-bottom: 4px;
    color: var(--boj-text-subtle);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .dashboard-note-box {
    border: 1px solid var(--boj-border);
    background: var(--boj-soft-bg);
    border-radius: 4px;
    padding: 12px 14px;
    margin-bottom: 14px;
  }
  .dashboard-note-box strong {
    display: inline;
    color: var(--boj-text-main);
  }
  .dashboard-stat-card {
    border: 1px solid var(--boj-border);
    border-radius: 4px;
    padding: 14px 16px;
    background: var(--boj-panel);
    min-height: 104px;
  }
  .dashboard-stat-label {
    color: var(--boj-text-subtle);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .dashboard-stat-value {
    display: block;
    margin-top: 8px;
    color: var(--boj-text-main);
    font-size: 26px;
    font-weight: 700;
    line-height: 1.2;
  }
  .dashboard-stat-note {
    display: block;
    margin-top: 6px;
    font-size: 12px;
    color: var(--boj-text-muted);
    word-break: break-word;
  }
  .dashboard-summary-table th {
    width: 34%;
    white-space: nowrap;
  }
  .dashboard-artifact-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }
  .dashboard-resume-stack {
    display: grid;
    gap: 14px;
  }
  .dashboard-resume-card {
    border: 1px solid var(--boj-border);
    border-top-width: 3px;
    border-radius: 4px;
    background: var(--boj-panel);
    padding: 14px 16px;
  }
  .dashboard-resume-card.sync { border-top-color: #f0ad4e; }
  .dashboard-resume-card.archive { border-top-color: #5cb85c; }
  .dashboard-resume-card.submissions { border-top-color: #337ab7; }
  .dashboard-resume-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .dashboard-resume-head h4 {
    margin: 4px 0 0;
    font-size: 17px;
    color: var(--boj-text-main);
  }
  .dashboard-resume-kicker {
    display: block;
    font-size: 12px;
    color: var(--boj-text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .dashboard-resume-meta {
    margin-top: 6px;
    font-size: 12px;
    color: var(--boj-text-muted);
  }
  .dashboard-resume-phase {
    margin-top: 12px;
  }
  .dashboard-resume-phase-label {
    display: block;
    font-size: 12px;
    color: var(--boj-text-subtle);
    margin-bottom: 2px;
  }
  .dashboard-resume-phase strong {
    color: var(--boj-text-main);
    font-size: 16px;
  }
  .dashboard-resume-stepbar {
    display: grid;
    gap: 8px;
    margin: 12px 0;
  }
  .dashboard-resume-step {
    display: block;
    border-radius: 4px;
    border: 1px solid #e5e5e5;
    background: #fafafa;
    color: var(--boj-text-muted);
    font-size: 12px;
    padding: 8px 10px;
  }
  .dashboard-resume-step.completed {
    border-color: #b2dba1;
    background: #f3faf1;
    color: #3c763d;
  }
  .dashboard-resume-step.active {
    border-color: #9ec5e5;
    background: #f3f8fc;
    color: #31708f;
    font-weight: 700;
  }
  .dashboard-resume-progress {
    margin-bottom: 10px;
  }
  .dashboard-resume-progress-bar {
    height: 10px;
    margin-bottom: 0;
  }
  .dashboard-resume-note {
    font-size: 12px;
    color: var(--boj-text-muted);
    margin-bottom: 10px;
    word-break: break-word;
  }
  .dashboard-resume-settings {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 12px;
  }
  .dashboard-resume-setting {
    display: inline-block;
    padding: 4px 8px;
    border-radius: 999px;
    background: var(--boj-soft-bg);
    border: 1px solid #e6e6e6;
    color: var(--boj-text-muted);
    font-size: 12px;
  }
  .dashboard-artifact-card {
    border: 1px solid var(--boj-border);
    border-top-width: 3px;
    border-radius: 4px;
    background: var(--boj-panel);
    padding: 14px 16px;
    min-height: 176px;
  }
  .dashboard-artifact-card.sync { border-top-color: #f0ad4e; }
  .dashboard-artifact-card.profile { border-top-color: #5bc0de; }
  .dashboard-artifact-card.submissions { border-top-color: #337ab7; }
  .dashboard-artifact-card.problems { border-top-color: #5cb85c; }
  .dashboard-artifact-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 10px;
  }
  .dashboard-artifact-head h4 {
    margin: 0;
    font-size: 16px;
    color: var(--boj-text-main);
  }
  .dashboard-artifact-flag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 3px;
    font-size: 11px;
    font-weight: 700;
  }
  .dashboard-artifact-flag.ready {
    background: #dff0d8;
    color: #3c763d;
  }
  .dashboard-artifact-flag.empty {
    background: #f5f5f5;
    color: #777;
  }
  .dashboard-artifact-value {
    display: block;
    margin: 14px 0 6px;
    font-size: 24px;
    font-weight: 700;
    color: var(--boj-text-main);
    line-height: 1.2;
  }
  .dashboard-artifact-meta {
    min-height: 38px;
    font-size: 12px;
    color: var(--boj-text-muted);
    word-break: break-word;
  }
  .dashboard-link-row {
    margin-top: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .dashboard-btn-primary {
    background: #3498db;
    border-color: #2980b9;
    color: #fff !important;
  }
  .dashboard-btn-primary:hover,
  .dashboard-btn-primary:focus {
    background: #2980b9;
    border-color: #2471a3;
    color: #fff !important;
  }
  .dashboard-status-badge {
    display: inline-block;
    padding: 4px 9px;
    border-radius: 3px;
    font-size: 12px;
    font-weight: 700;
    vertical-align: middle;
  }
  .dashboard-status-badge.idle { background: #f5f5f5; color: #777; }
  .dashboard-status-badge.running { background: #d9edf7; color: #31708f; }
  .dashboard-status-badge.stopping { background: #fcf8e3; color: #8a6d3b; }
  .dashboard-status-badge.stopped { background: #f5f5f5; color: #6d5d46; }
  .dashboard-status-badge.completed { background: #dff0d8; color: #3c763d; }
  .dashboard-status-badge.failed { background: #f2dede; color: #a94442; }
  .dashboard-task-title {
    margin: 12px 0 6px;
    font-size: 22px;
    color: var(--boj-text-main);
  }
  .dashboard-task-meta {
    margin-bottom: 12px;
    font-size: 12px;
    color: var(--boj-text-muted);
  }
  .dashboard-step-visual {
    margin-bottom: 16px;
  }
  .dashboard-stepper {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 0;
    margin: 0 0 12px;
  }
  .dashboard-step {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-width: 180px;
    flex: 1 1 180px;
    padding: 10px 12px;
    border: 1px solid var(--boj-border);
    background: #fff;
    border-radius: 4px;
  }
  .dashboard-step.pending { background: #fafafa; border-color: #e5e5e5; }
  .dashboard-step.active { border-color: #9ec5e5; background: #f3f8fc; box-shadow: inset 0 0 0 1px #d9edf7; }
  .dashboard-step.completed { border-color: #b2dba1; background: #f3faf1; }
  .dashboard-step.failed { border-color: #e4b9b9; background: #fcf4f4; }
  .dashboard-step.stopped { border-color: #e8d39c; background: #fffaf0; }
  .dashboard-step-connector {
    flex: 0 0 18px;
    align-self: center;
    height: 1px;
    background: #d9d9d9;
    margin: 0 4px;
  }
  .dashboard-step-icon {
    display: inline-flex;
    width: 24px;
    height: 24px;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    border: 1px solid #d5d5d5;
    color: #8d8d8d;
    background: #fff;
    font-size: 12px;
    flex: 0 0 24px;
    margin-top: 1px;
  }
  .dashboard-step.active .dashboard-step-icon { color: #31708f; border-color: #9ec5e5; }
  .dashboard-step.completed .dashboard-step-icon { color: #3c763d; border-color: #b2dba1; }
  .dashboard-step.failed .dashboard-step-icon { color: #a94442; border-color: #e4b9b9; }
  .dashboard-step.stopped .dashboard-step-icon { color: #8a6d3b; border-color: #e8d39c; }
  .dashboard-step-body { min-width: 0; }
  .dashboard-step-label {
    display: block;
    color: var(--boj-text-main);
    font-size: 13px;
    font-weight: 700;
    line-height: 1.3;
  }
  .dashboard-step-note {
    display: block;
    margin-top: 3px;
    color: var(--boj-text-muted);
    font-size: 12px;
    line-height: 1.4;
    word-break: break-word;
  }
  .dashboard-checklist {
    border: 1px solid var(--boj-border);
    border-radius: 4px;
    background: var(--boj-soft-bg);
    padding: 12px 14px;
  }
  .dashboard-checklist-title {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--boj-text-main);
  }
  .dashboard-checklist-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .dashboard-checklist-item {
    display: flex;
    gap: 10px;
    align-items: flex-start;
  }
  .dashboard-checklist-item + .dashboard-checklist-item {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px solid #ececec;
  }
  .dashboard-check-icon {
    display: inline-flex;
    width: 20px;
    height: 20px;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    border: 1px solid #d5d5d5;
    color: #8d8d8d;
    background: #fff;
    font-size: 11px;
    flex: 0 0 20px;
    margin-top: 1px;
  }
  .dashboard-checklist-item.active .dashboard-check-icon { color: #31708f; border-color: #9ec5e5; }
  .dashboard-checklist-item.completed .dashboard-check-icon { color: #3c763d; border-color: #b2dba1; }
  .dashboard-checklist-item.failed .dashboard-check-icon { color: #a94442; border-color: #e4b9b9; }
  .dashboard-checklist-item.stopped .dashboard-check-icon { color: #8a6d3b; border-color: #e8d39c; }
  .dashboard-check-content { min-width: 0; }
  .dashboard-check-label {
    display: block;
    color: var(--boj-text-main);
    font-size: 13px;
    line-height: 1.3;
  }
  .dashboard-check-note {
    display: block;
    margin-top: 2px;
    color: var(--boj-text-muted);
    font-size: 12px;
    line-height: 1.4;
    word-break: break-word;
  }
  .dashboard-progress-meta {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 6px;
    font-size: 12px;
    color: var(--boj-text-muted);
  }
  .dashboard-progress .progress { height: 10px; margin-bottom: 14px; }
  .dashboard-problem-progress {
    border: 1px solid var(--boj-border);
    border-radius: 4px;
    background: var(--boj-soft-bg);
    padding: 14px 16px;
    margin-bottom: 16px;
  }
  .dashboard-problem-progress-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 10px;
  }
  .dashboard-problem-progress-label {
    display: block;
    font-size: 12px;
    color: var(--boj-text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .dashboard-problem-progress-value {
    display: flex;
    align-items: baseline;
    gap: 6px;
    margin-top: 6px;
    color: var(--boj-text-main);
  }
  .dashboard-problem-progress-value strong {
    font-size: 30px;
    line-height: 1;
  }
  .dashboard-problem-progress-value span {
    font-size: 18px;
    color: var(--boj-text-muted);
  }
  .dashboard-problem-progress-note {
    margin-top: 6px;
    font-size: 12px;
    color: var(--boj-text-muted);
  }
  .dashboard-problem-progress-percent {
    font-size: 22px;
    font-weight: 700;
    color: var(--boj-link);
    white-space: nowrap;
  }
  .dashboard-problem-progress-bar {
    height: 12px;
    margin-bottom: 14px;
  }
  .dashboard-problem-progress-grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin-bottom: 12px;
  }
  .dashboard-problem-progress-stat {
    border: 1px solid #e6e6e6;
    border-radius: 4px;
    background: #fff;
    padding: 10px 12px;
  }
  .dashboard-problem-progress-stat-label {
    display: block;
    font-size: 12px;
    color: var(--boj-text-subtle);
    margin-bottom: 4px;
  }
  .dashboard-problem-progress-stat strong {
    font-size: 22px;
    color: var(--boj-text-main);
    line-height: 1.2;
  }
  .dashboard-problem-progress-details {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
  }
  .dashboard-problem-progress-detail {
    border-top: 1px solid #ececec;
    padding-top: 10px;
  }
  .dashboard-problem-progress-detail-label {
    display: block;
    margin-bottom: 4px;
    font-size: 12px;
    color: var(--boj-text-subtle);
  }
  .dashboard-problem-progress-detail strong {
    display: block;
    color: var(--boj-text-main);
    font-size: 13px;
    line-height: 1.45;
    word-break: break-word;
  }
  .dashboard-status-table th { width: 28%; color: var(--boj-text-subtle); }
  .dashboard-log-panel { max-height: 420px; overflow: auto; }
  .dashboard-log-list { margin-bottom: 0; }
  .dashboard-log-list .list-group-item {
    font-family: "Source Code Pro", monospace;
    font-size: 12px;
    white-space: pre-wrap;
    color: var(--boj-text-main);
  }
  .dashboard-empty { color: var(--boj-text-subtle); font-style: italic; }
  @media (max-width: 767px) {
    .dashboard-artifact-grid { grid-template-columns: 1fr; }
    .dashboard-resume-head { flex-direction: column; }
    .dashboard-nav-note { display: none; }
    .dashboard-task-controls { margin-top: 10px; }
    .dashboard-step { min-width: 100%; }
    .dashboard-step-connector { display: none; }
    .dashboard-problem-progress-head { flex-direction: column; }
    .dashboard-problem-progress-grid { grid-template-columns: 1fr; }
    .dashboard-problem-progress-details { grid-template-columns: 1fr; }
  }
`;

export const PROFILE_PAGE_STYLE = `
  :root {
    --boj-text-main: #333;
    --boj-text-muted: #555;
    --boj-text-subtle: #777;
    --boj-link: #0076c0;
    --boj-border: #ddd;
    --boj-soft-bg: #fff;
  }
  body {
    background: #fff;
    color: var(--boj-text-main);
  }
  p, li, li a, blockquote, .profile-bio,
  .viewer-meta-card, .viewer-source-links, .viewer-empty,
  .viewer-topbar-note, .panel-body {
    color: var(--boj-text-muted);
  }
  a,
  a:focus,
  a:hover,
  a:active {
    color: var(--boj-link);
  }
  .profile-header { margin-bottom: 20px; }
  .viewer-topbar-note { margin-left: 10px; font-size: 12px; }
  .viewer-nav .navbar-nav > li > a { padding-left: 14px; padding-right: 14px; }
  .viewer-panel-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }
  .viewer-meta-card { background: var(--boj-soft-bg); border: 1px solid var(--boj-border); border-radius: 4px; padding: 14px 16px; min-height: 90px; }
  .viewer-meta-card strong { display: block; margin-bottom: 6px; color: var(--boj-text-main); }
  .viewer-meta-card span { color: inherit; word-break: break-word; }
  .viewer-empty { color: var(--boj-text-muted); font-style: italic; }
  .problem-list a,
  .problem-list a:link,
  .problem-list a:visited,
  .problem-list a:hover,
  .problem-list a:active {
    color: var(--boj-link) !important;
  }
  .problem-list a { display: inline-block; margin-right: 6px; margin-bottom: 6px; }
  .profile-bio { display: block; margin-bottom: 12px; }
  .viewer-source-links { margin-top: 10px; font-size: 12px; }
  .viewer-source-links a { margin-right: 12px; }
  .table-responsive { border: 0; }
  @media (max-width: 767px) {
    .page-header h1 { font-size: 28px; }
    .viewer-topbar-note { display: none; }
  }
`;

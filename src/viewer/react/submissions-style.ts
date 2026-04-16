export const SUBMISSIONS_PAGE_STYLE = `
  body { background: #fff; color: #333; }
  a, a:focus, a:hover, a:active { color: #0076c0; }
  .viewer-topbar-note { margin-left: 10px; color: #777; font-size: 12px; }
  .viewer-nav .navbar-nav > li > a { padding-left: 14px; padding-right: 14px; }
  .viewer-status-meta {
    margin-bottom: 12px;
    color: #555;
    font-size: 12px;
  }
  .viewer-status-links {
    margin-top: 10px;
    font-size: 12px;
  }
  .viewer-status-wrap {
    max-height: 75vh;
    overflow: auto;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
  .viewer-status-wrap table {
    margin-bottom: 0;
  }
  .viewer-status-wrap thead th {
    position: sticky;
    top: 0;
    background: #fff;
    z-index: 1;
  }
  .viewer-submission-id {
    font-family: "Source Code Pro", monospace;
    white-space: nowrap;
  }
  @media (max-width: 767px) {
    .viewer-topbar-note { display: none; }
  }
`;

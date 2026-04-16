
    const initialState = JSON.parse(document.getElementById("dashboard-initial-state").textContent);
    let dashboardState = initialState;

    function escapeHtml(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function getTaskStatusMeta(status) {
      switch (status) {
        case "running":
          return { label: "실행 중", className: "running" };
        case "stopping":
          return { label: "중지 중", className: "stopping" };
        case "stopped":
          return { label: "중지됨", className: "stopped" };
        case "completed":
          return { label: "완료", className: "completed" };
        case "failed":
          return { label: "실패", className: "failed" };
        default:
          return { label: "대기", className: "idle" };
      }
    }

    function extractTaskProgress(task) {
      if (!task || !Array.isArray(task.statusLines)) {
        return null;
      }

      for (const line of task.statusLines) {
        const progressMatch = line.match(/진행:s*(d+)/(d+)/);
        if (progressMatch) {
          const done = Number(progressMatch[1]);
          const total = Number(progressMatch[2]);
          if (total > 0) {
            return {
              percent: Math.max(0, Math.min(100, (done / total) * 100)),
              label: done + " / " + total,
            };
          }
        }

        const phaseMatch = line.match(/단계:s*(d+)/(d+)/);
        if (phaseMatch) {
          const done = Number(phaseMatch[1]);
          const total = Number(phaseMatch[2]);
          if (total > 0) {
            return {
              percent: Math.max(0, Math.min(100, (done / total) * 100)),
              label: done + " / " + total + " 단계",
            };
          }
        }
      }

      return null;
    }

    function renderHeroStats(artifacts) {
      const stats = [
        {
          label: "체크포인트",
          value: artifacts.sync.exists ? (artifacts.sync.phase || "사용 중") : "없음",
          note: artifacts.sync.exists ? "업데이트 " + escapeHtml(artifacts.sync.updatedAt || "-") : "대기 중인 백업 체크포인트 없음",
        },
        {
          label: "프로필",
          value: artifacts.profile.username || "-",
          note: artifacts.profile.exists ? "프로필 저장 " + escapeHtml(artifacts.profile.fetchedAt || "-") : "아직 프로필 JSON 없음",
        },
        {
          label: "제출",
          value: artifacts.submissions.totalCount === null ? "-" : escapeHtml(String(artifacts.submissions.totalCount)),
          note: artifacts.submissions.exists ? escapeHtml(artifacts.submissions.username || "-") + " 제출 백업" : "아직 제출 JSON 없음",
        },
        {
          label: "문제",
          value: escapeHtml(String(artifacts.problems.totalCount || 0)),
          note: artifacts.problems.exists ? "백업된 문제 폴더" : "문제 폴더가 비어 있음",
        },
      ];

      document.getElementById("hero-stats").innerHTML = stats
        .map((item) => `
          <div class="col-sm-6 col-md-3">
            <div class="dashboard-stat-card">
              <span class="dashboard-stat-label">${escapeHtml(item.label)}</span>
              <span class="dashboard-stat-value">${item.value}</span>
              <span class="dashboard-stat-note">${item.note}</span>
            </div>
          </div>
        `)
        .join("");
    }

    function renderSummary(artifacts) {
      const username =
        artifacts.profile.username ||
        artifacts.submissions.username ||
        artifacts.sync.username ||
        "-";
      const rows = [
        ["사용자", username],
        ["프로필 JSON", artifacts.profile.exists ? (artifacts.profile.fetchedAt || "저장됨") : "없음"],
        ["제출 JSON", artifacts.submissions.exists ? String(artifacts.submissions.totalCount || 0) + "개 제출" : "없음"],
        ["문제 폴더", artifacts.problems.exists ? String(artifacts.problems.totalCount) + "개 문제" : "없음"],
        ["백업 체크포인트", artifacts.sync.exists ? (artifacts.sync.phase || "사용 중") + " · " + (artifacts.sync.updatedAt || "-") : "없음"],
      ];

      document.getElementById("summary-panel").innerHTML =
        '<table id="statics" class="table table-hover dashboard-summary-table"><tbody>' +
        rows.map((row) => '<tr><th>' + escapeHtml(row[0]) + '</th><td>' + escapeHtml(row[1]) + '</td></tr>').join("") +
        '</tbody></table>';
    }

    function renderArtifactCard(card) {
      return `
        <div class="dashboard-artifact-card ${escapeHtml(card.tone)}">
          <div class="dashboard-artifact-head">
            <h4>${escapeHtml(card.title)}</h4>
            <span class="dashboard-artifact-flag ${card.exists ? "ready" : "empty"}">${card.exists ? "READY" : "EMPTY"}</span>
          </div>
          <span class="dashboard-artifact-value">${card.value}</span>
          <div class="dashboard-artifact-meta">${card.note}</div>
          <div class="dashboard-link-row">${card.actions}</div>
        </div>
      `;
    }

    function renderArtifacts(artifacts) {
      renderHeroStats(artifacts);
      renderSummary(artifacts);

      const cards = [
        {
          tone: "sync",
          title: "백업 체크포인트",
          exists: artifacts.sync.exists,
          value: artifacts.sync.exists ? escapeHtml(artifacts.sync.phase || "사용 중") : "없음",
          note: artifacts.sync.exists
            ? "사용자 " + escapeHtml(artifacts.sync.username || "-") + " · " + escapeHtml(artifacts.sync.updatedAt || "-")
            : "현재 이어받을 sync 체크포인트가 없습니다.",
          actions:
            '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\'sync\')">체크포인트 위치 열기</button>',
        },
        {
          tone: "profile",
          title: "프로필 JSON",
          exists: artifacts.profile.exists,
          value: artifacts.profile.username ? escapeHtml(artifacts.profile.username) : "없음",
          note: artifacts.profile.exists
            ? "프로필 저장 시각 " + escapeHtml(artifacts.profile.fetchedAt || "-")
            : "프로필 JSON이 아직 생성되지 않았습니다.",
          actions: artifacts.profile.exists
            ? '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\'profile\')">저장 위치 열기</button>' +
              '<a class="btn btn-xs dashboard-btn-primary" href="' + escapeHtml(artifacts.profile.infoUrl) + '">프로필 보기</a>' +
              '<a class="btn btn-default btn-xs" href="' + escapeHtml(artifacts.profile.languageUrl) + '">언어 보기</a>'
            : '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\'profile\')">저장 위치 열기</button>',
        },
        {
          tone: "submissions",
          title: "제출 JSON",
          exists: artifacts.submissions.exists,
          value: artifacts.submissions.totalCount === null ? "없음" : escapeHtml(String(artifacts.submissions.totalCount)),
          note: artifacts.submissions.exists
            ? "사용자 " + escapeHtml(artifacts.submissions.username || "-") + " 제출 백업"
            : "제출 기록 JSON이 아직 생성되지 않았습니다.",
          actions: artifacts.submissions.exists
            ? '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\'submissions\')">저장 위치 열기</button>' +
              '<a class="btn btn-xs dashboard-btn-primary" href="' + escapeHtml(artifacts.submissions.statusUrl) + '">제출 보기</a>'
            : '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\'submissions\')">저장 위치 열기</button>',
        },
        {
          tone: "problems",
          title: "문제 백업",
          exists: artifacts.problems.exists,
          value: escapeHtml(String(artifacts.problems.totalCount || 0)),
          note: artifacts.problems.exists
            ? "문제 폴더, 메타, 문제별 제출 기록과 코드가 저장돼 있습니다."
            : "문제 폴더가 아직 비어 있습니다.",
          actions: artifacts.problems.exists
            ? '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\'problems\')">저장 위치 열기</button>' +
              '<a class="btn btn-xs dashboard-btn-primary" href="' + escapeHtml(artifacts.problems.listUrl) + '">문제 목록 보기</a>'
            : '<button type="button" class="btn btn-default btn-xs" onclick="openArtifactLocation(\'problems\')">저장 위치 열기</button>',
        },
      ];

      document.getElementById("artifacts-panel").innerHTML =
        '<div class="dashboard-artifact-grid">' + cards.map(renderArtifactCard).join("") + '</div>';
    }

    function renderStatusRows(lines) {
      if (!lines || lines.length === 0) {
        return '<tr><td colspan="2" class="dashboard-empty">상태 정보가 없습니다.</td></tr>';
      }

      return lines.map((line) => {
        const index = line.indexOf(":");
        if (index === -1) {
          return '<tr><th>Status</th><td>' + escapeHtml(line) + '</td></tr>';
        }

        const label = line.slice(0, index).trim();
        const value = line.slice(index + 1).trim();
        return '<tr><th>' + escapeHtml(label) + '</th><td>' + escapeHtml(value) + '</td></tr>';
      }).join("");
    }

    function renderTask(task) {
      const target = document.getElementById("task-panel");
      const logsTarget = document.getElementById("log-panel");

      if (!task) {
        target.innerHTML = '<p class="dashboard-empty">아직 실행된 작업이 없습니다.</p>';
        logsTarget.innerHTML = '<p class="dashboard-empty">로그가 없습니다.</p>';
        return;
      }

      const status = getTaskStatusMeta(task.status);
      const progress = extractTaskProgress(task);
      target.innerHTML = `
        <div class="clearfix">
          <span class="dashboard-status-badge ${status.className}">${status.label}</span>
          ${(task.status === "running" || task.status === "stopping")
            ? '<div class="pull-right dashboard-task-controls"><button id="stop-task-button" type="button" class="btn btn-default btn-xs"' + (task.status === "stopping" ? ' disabled' : '') + '>중지 요청</button></div>'
            : ''}
        </div>
        <h3 class="dashboard-task-title">${escapeHtml(task.title)}</h3>
        <p class="dashboard-task-meta">시작: ${escapeHtml(task.startedAt)}${task.finishedAt ? ' · 종료: ' + escapeHtml(task.finishedAt) : ''}</p>
        ${task.summary ? '<div class="alert alert-info">' + escapeHtml(task.summary) + '</div>' : ''}
        ${progress ? '<div class="dashboard-progress"><div class="dashboard-progress-meta"><span>진행률</span><span>' + escapeHtml(progress.label) + '</span></div><div class="progress progress-u"><div class="progress-bar progress-bar-u" role="progressbar" style="width:' + progress.percent.toFixed(1) + '%"></div></div></div>' : ''}
        <div class="table-responsive">
          <table class="table table-striped dashboard-status-table">
            <tbody>${renderStatusRows(task.statusLines || [])}</tbody>
          </table>
        </div>
      `;

      const stopButton = document.getElementById("stop-task-button");
      if (stopButton) {
        stopButton.addEventListener("click", async () => {
          await stopCurrentTask();
        });
      }

      logsTarget.innerHTML = (task.logs && task.logs.length > 0)
        ? '<ul class="list-group dashboard-log-list">' + task.logs.map((line) => '<li class="list-group-item">' + escapeHtml(line) + '</li>').join("") + '</ul>'
        : '<p class="dashboard-empty">로그가 없습니다.</p>';
    }

    function renderState(state) {
      renderArtifacts(state.artifacts);
      renderTask(state.task);
      const running = !!(state.task && (state.task.status === "running" || state.task.status === "stopping"));
      document.querySelectorAll("button[type=submit]").forEach((button) => {
        button.disabled = running;
      });
    }

    async function readJsonResponse(response) {
      const text = await response.text();
      if (!text) {
        return {};
      }

      try {
        return JSON.parse(text);
      } catch (error) {
        console.error("dashboard response parse error", error, text);
        return {
          error: "응답을 읽지 못했습니다.",
        };
      }
    }

    function setFormPending(form, pending, pendingLabel) {
      const submitButton = form ? form.querySelector("button[type=submit]") : null;
      if (!submitButton) {
        return;
      }

      if (!submitButton.dataset.originalLabel) {
        submitButton.dataset.originalLabel = submitButton.textContent || "";
      }

      submitButton.disabled = pending;
      submitButton.textContent = pending
        ? pendingLabel
        : submitButton.dataset.originalLabel;
    }

    async function refreshState(showAlertOnError = false) {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        const payload = await readJsonResponse(response);
        if (!response.ok) {
          throw new Error(payload.error || "상태를 불러오지 못했습니다.");
        }

        dashboardState = payload;
        renderState(dashboardState);
      } catch (error) {
        console.error("dashboard state refresh failed", error);
        if (showAlertOnError) {
          alert(error instanceof Error ? error.message : "상태를 불러오지 못했습니다.");
        }
      }
    }

    async function startTask(formId, endpoint) {
      const form = document.getElementById(formId);
      if (!form) {
        alert("작업 폼을 찾지 못했습니다. 페이지를 새로고침하세요.");
        return;
      }

      setFormPending(form, true, "시작 중...");

      try {
        const body = new URLSearchParams(new FormData(form));
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body,
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) {
          alert(payload.error || "작업 시작에 실패했습니다.");
          return;
        }

        await refreshState(true);
      } catch (error) {
        console.error("dashboard start task failed", error);
        alert(error instanceof Error ? error.message : "작업 시작에 실패했습니다.");
      } finally {
        setFormPending(form, false, "시작 중...");
        renderState(dashboardState);
      }
    }

    async function openArtifactLocation(key) {
      try {
        const response = await fetch("/api/open-location", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
          },
          body: new URLSearchParams({ key }),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) {
          alert(payload.error || "저장 위치를 열지 못했습니다.");
        }
      } catch (error) {
        console.error("dashboard open location failed", error);
        alert(error instanceof Error ? error.message : "저장 위치를 열지 못했습니다.");
      }
    }

    async function stopCurrentTask() {
      try {
        const response = await fetch("/api/tasks/stop", {
          method: "POST",
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) {
          alert(payload.error || "중지 요청에 실패했습니다.");
          return;
        }

        await refreshState(true);
      } catch (error) {
        console.error("dashboard stop task failed", error);
        alert(error instanceof Error ? error.message : "중지 요청에 실패했습니다.");
      }
    }

    document.getElementById("profile-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      await startTask("profile-form", "/api/tasks/profile");
    });

    document.getElementById("archive-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      await startTask("archive-form", "/api/tasks/archive");
    });

    renderState(dashboardState);
    setInterval(() => {
      void refreshState(false);
    }, 1500);
  
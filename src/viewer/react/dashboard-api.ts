import type { DashboardStateResponse } from "../dashboard-types.js";

export async function refreshState(showAlertOnError = false): Promise<DashboardStateResponse | null> {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    const payload = await readJsonResponse<DashboardStateResponse>(response);
    if (!response.ok) {
      throw new Error(payload.error || "상태를 불러오지 못했습니다.");
    }

    return payload;
  } catch (error) {
    console.error("dashboard state refresh failed", error);
    if (showAlertOnError) {
      alert(error instanceof Error ? error.message : "상태를 불러오지 못했습니다.");
    }
    return null;
  }
}

export async function startTask(endpoint: string, body = new URLSearchParams()): Promise<void> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        accept: "application/json",
        "x-requested-with": "fetch",
      },
      body,
    });
    const payload = await readJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error || "작업 시작에 실패했습니다.");
    }
  } catch (error) {
    console.error("dashboard start task failed", error);
    alert(error instanceof Error ? error.message : "작업 시작에 실패했습니다.");
    throw error;
  }
}

export async function openArtifactLocation(key: string): Promise<void> {
  try {
    const response = await fetch("/api/open-location", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams({ key }),
    });
    const payload = await readJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error || "저장 위치를 열지 못했습니다.");
    }
  } catch (error) {
    console.error("dashboard open location failed", error);
    alert(error instanceof Error ? error.message : "저장 위치를 열지 못했습니다.");
  }
}

export async function stopCurrentTask(): Promise<DashboardStateResponse | null> {
  try {
    const response = await fetch("/api/tasks/stop", {
      method: "POST",
    });
    const payload = await readJsonResponse<{ error?: string }>(response);
    if (!response.ok) {
      throw new Error(payload.error || "중지 요청에 실패했습니다.");
    }

    return await refreshState(true);
  } catch (error) {
    console.error("dashboard stop task failed", error);
    alert(error instanceof Error ? error.message : "중지 요청에 실패했습니다.");
    return null;
  }
}

async function readJsonResponse<T extends object>(response: Response): Promise<T & { error?: string }> {
  const text = await response.text();
  if (!text) {
    return {} as T & { error?: string };
  }

  try {
    return JSON.parse(text) as T & { error?: string };
  } catch (error) {
    console.error("dashboard response parse error", error, text);
    return {
      error: "응답을 읽지 못했습니다.",
    } as T & { error?: string };
  }
}

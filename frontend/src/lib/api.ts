const API_BASE = '/api';

export interface Check {
  timestamp: string;
  status: 'ok' | 'fail' | 'error' | 'timeout';
  responseTime: number;
}

export interface Service {
  id: string;
  name: string;
  model?: string | null;
  currentStatus: 'ok' | 'fail' | 'error' | 'timeout' | 'unknown';
  lastCheck: string | null;
  recentChecks?: Check[];
}

export interface ServiceCheckDetail {
  name: string;
  status: 'ok' | 'fail' | 'error' | 'timeout';
  responseTime: number;
  stdout: string;
  stderr: string;
  answer: string | null;
  message: string | null;
  checkedAt: string;
  expectedAnswer: unknown;
}

export interface ServiceDetailResponse {
  serviceId: string;
  lastCheck: string | null;
  result: ServiceCheckDetail;
}

async function parseJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T;
  return data;
}

async function handleResponse<T>(res: Response, errorMessage: string): Promise<T> {
  if (!res.ok) {
    // 不暴露后端错误详情,统一显示通用错误消息
    throw new Error(errorMessage);
  }
  return parseJson<T>(res);
}

export const api = {
  async getServices(): Promise<{ services: Service[] }> {
    const res = await fetch(`${API_BASE}/services`);
    return handleResponse(res, '无法获取服务列表');
  },

  async getServiceDetail(serviceId: string): Promise<ServiceDetailResponse | null> {
    const res = await fetch(`${API_BASE}/services/${serviceId}/detail`);
    if (res.status === 404) {
      return null;
    }
    return handleResponse(res, '无法获取服务详情');
  }
};

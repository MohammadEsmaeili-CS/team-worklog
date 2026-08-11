const API_BASE_URL = '/api';

async function request(path, options = {}) {
  const hasBody = options.body !== undefined;

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      ...(hasBody
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
    body:
      hasBody && typeof options.body !== 'string'
        ? JSON.stringify(options.body)
        : options.body,
  });

  const data = await response.json().catch(() => ({
    message: 'پاسخ نامعتبر از سرور دریافت شد.',
  }));

  if (!response.ok) {
    const error = new Error(
      data.message || 'درخواست انجام نشد.',
    );

    error.status = response.status;
    error.data = data;

    throw error;
  }

  return data;
}

export const api = {
  get(path) {
    return request(path);
  },

  post(path, body) {
    return request(path, {
      method: 'POST',
      body,
    });
  },

  put(path, body) {
    return request(path, {
      method: 'PUT',
      body,
    });
  },

  patch(path, body) {
    return request(path, {
      method: 'PATCH',
      body,
    });
  },
};
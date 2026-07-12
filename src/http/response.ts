export function withoutResponseBody(response: Response): Response {
  if (response.body === null) {
    return response;
  }
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

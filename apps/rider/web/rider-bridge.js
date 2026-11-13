/*
 * Rider/JCEF bridge for the shared SS14 Studio UI.
 *
 * The UI bundle only knows the VS Code webview API shape. This script provides
 * the same shape on window.ss14StudioBridge and connects it to the loopback
 * sidecar with SSE for host -> UI messages and POST for UI -> host messages.
 */
(() => {
  'use strict';

  const bootstrap = window.__SS14_BOOTSTRAP__ || {};
  const token = typeof bootstrap.token === 'string' ? bootstrap.token : '';
  const params = new URLSearchParams(window.location.search);
  if (!token && params.get('token')) bootstrap.token = params.get('token');
  const effectiveToken = bootstrap.token || token;
  const withToken = (url) => {
    if (!effectiveToken) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(effectiveToken)}`;
  };

  let uiState =
    bootstrap.uiState && typeof bootstrap.uiState === 'object'
      ? bootstrap.uiState
      : {};
  let saveTimer = 0;
  let pendingSave = null;

  const persistState = () => {
    if (pendingSave) return;
    pendingSave = window.setTimeout(() => {
      pendingSave = null;
      void fetch(withToken('/api/ui-state'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(uiState),
      }).catch(() => undefined);
    }, 180);
  };

  let sendQueue = Promise.resolve();
  const send = (message) => {
    sendQueue = sendQueue
      .then(() =>
        fetch(withToken('/api/message'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(message),
        }),
      )
      .then((response) => {
        if (!response.ok) {
          console.error('[ss14-studio] host rejected a message', response.status);
        }
      })
      .catch((error) => {
        console.error('[ss14-studio] could not reach the host', error);
      });
  };

  let source = null;
  let reconnectTimer = 0;
  const connect = () => {
    if (source) return;
    try {
      source = new EventSource(withToken('/api/events'));
    } catch (error) {
      console.error('[ss14-studio] could not open the event stream', error);
      return;
    }
    source.onopen = () => {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = 0;
      }
    };
    source.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      window.dispatchEvent(new MessageEvent('message', { data }));
    };
    source.onerror = () => {
      // EventSource reconnects on its own; recreate it when the browser closes it.
      if (source && source.readyState === EventSource.CLOSED) {
        source = null;
        if (!reconnectTimer) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = 0;
            connect();
          }, 1200);
        }
      }
    };
  };

  window.ss14StudioBridge = {
    postMessage(message) {
      send(message);
    },
    getState() {
      return uiState;
    },
    setState(next) {
      uiState = next && typeof next === 'object' ? next : {};
      persistState();
    },
  };

  if (bootstrap.theme) {
    document.documentElement.dataset.theme = bootstrap.theme;
  }
  document.documentElement.classList.toggle(
    'no-animations',
    bootstrap.config && bootstrap.config.animations === false,
  );

  connect();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (source && source.readyState === EventSource.CLOSED) {
      source = null;
      connect();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (source) source.close();
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
  });
})();

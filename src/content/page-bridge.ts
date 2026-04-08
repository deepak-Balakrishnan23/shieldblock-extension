(function bootstrapShieldBlockPageBridge() {
  const eventName = 'shieldblock:url-change';
  const policyEvent = 'shieldblock:policy-change';
  let blocked = false;
  type ShieldBlockRequest = XMLHttpRequest & { __shieldblockUrl?: string };

  const dispatch = () => window.dispatchEvent(new Event(eventName));
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  const originalFetch = window.fetch.bind(window);
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  const originalPlay = HTMLMediaElement.prototype.play;

  function shouldBlockUrl(raw: unknown) {
    const value = String(raw || '');
    return /youtube\.com|youtu\.be|youtube-nocookie\.com|googlevideo\.com/i.test(value);
  }

  history.pushState = function pushState(...args) {
    const result = originalPushState.apply(this, args);
    dispatch();
    return result;
  };

  history.replaceState = function replaceState(...args) {
    const result = originalReplaceState.apply(this, args);
    dispatch();
    return result;
  };

  window.addEventListener('popstate', dispatch, true);
  window.addEventListener('hashchange', dispatch, true);
  window.addEventListener(policyEvent, ((event: Event) => {
    const customEvent = event as CustomEvent<{ blocked?: boolean }>;
    blocked = Boolean(customEvent.detail && customEvent.detail.blocked);
  }) as EventListener);

  window.fetch = function shieldBlockFetch(input: RequestInfo | URL, init?: RequestInit) {
    const target = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    if (blocked && shouldBlockUrl(target)) {
      return Promise.reject(new Error('Blocked by ShieldBlock'));
    }
    return originalFetch(input, init);
  };

  XMLHttpRequest.prototype.open = function shieldBlockOpen(
    this: ShieldBlockRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    this.__shieldblockUrl = String(url || '');
    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function shieldBlockSend(
    this: ShieldBlockRequest,
    ...args: Parameters<typeof originalSend>
  ) {
    if (blocked && shouldBlockUrl(this.__shieldblockUrl)) {
      throw new Error('Blocked by ShieldBlock');
    }
    return originalSend.apply(this, args);
  };

  HTMLMediaElement.prototype.play = function shieldBlockPlay(...args: Parameters<typeof originalPlay>) {
    const source = this.currentSrc || this.src || '';
    if (blocked || shouldBlockUrl(source)) {
      this.pause();
      return Promise.reject(new DOMException('Playback blocked by ShieldBlock', 'NotAllowedError'));
    }
    return originalPlay.apply(this, args);
  };
})();

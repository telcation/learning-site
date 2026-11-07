// Only a change notification crosses tabs; credentials never leave IndexedDB.
const channelName = 'learning-device-state-v1';

export function notifyDeviceForgotten() {
  if (typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(channelName);
  channel.postMessage('forgotten');
  channel.close();
}

export function watchDeviceForgotten(onForgotten: () => void) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  const channel = new BroadcastChannel(channelName);
  channel.onmessage = event => {
    if (event.data === 'forgotten') onForgotten();
  };
  return () => channel.close();
}

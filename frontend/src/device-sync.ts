// Only a change notification crosses tabs; credentials never leave IndexedDB.
const defaultChannelName = 'learning-device-state-v1';

export function notifyDeviceForgotten(channelName = defaultChannelName) {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    const channel = new BroadcastChannel(channelName);
    try { channel.postMessage('forgotten'); } finally { channel.close(); }
  } catch { /* Local removal/end must still complete when messaging is blocked. */ }
}

export function watchDeviceForgotten(onForgotten: () => void, channelName = defaultChannelName) {
  if (typeof BroadcastChannel === 'undefined') return () => {};
  let channel: BroadcastChannel;
  try { channel = new BroadcastChannel(channelName); } catch { return () => {}; }
  channel.onmessage = event => {
    if (event.data === 'forgotten') onForgotten();
  };
  return () => channel.close();
}

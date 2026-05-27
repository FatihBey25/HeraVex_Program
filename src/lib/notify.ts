import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

let _permitted: boolean | null = null;

async function permitted(): Promise<boolean> {
  if (_permitted !== null) return _permitted;
  _permitted = await isPermissionGranted();
  if (!_permitted) {
    const status = await requestPermission();
    _permitted = status === "granted";
  }
  return _permitted;
}

export async function notify(title: string, body?: string) {
  try {
    if (!(await permitted())) return;
    sendNotification({ title, body });
  } catch {
    // silently ignore — notifications are non-critical
  }
}

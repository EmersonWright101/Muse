use tauri::Manager;

#[derive(serde::Deserialize)]
struct TaskReminder {
    id: String,
    title: String,
    body: String,
    #[serde(rename = "notifyAt")]
    notify_at: f64, // Unix seconds
}

// ─── macOS: foreground banners + OS-scheduled reminders + dock badge ──────────
#[cfg(target_os = "macos")]
mod macos_notif {
    use block2::Block;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{define_class, ClassType, MainThreadMarker};
    use objc2_app_kit::NSApplication;
    use objc2_foundation::{NSObject, NSObjectProtocol, NSString};
    use objc2_user_notifications::{
        UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions,
        UNNotificationRequest, UNNotificationSound, UNTimeIntervalNotificationTrigger,
        UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "MuseNotificationDelegate"]
        pub struct MuseNotificationDelegate;

        unsafe impl NSObjectProtocol for MuseNotificationDelegate {}

        unsafe impl UNUserNotificationCenterDelegate for MuseNotificationDelegate {
            // Called when a notification arrives while the app is in the foreground.
            // Returning Banner + Sound makes macOS show the popup banner.
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            unsafe fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                completion_handler: &Block<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                let opts = UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::Sound
                    | UNNotificationPresentationOptions::Badge;
                completion_handler.call((opts,));
            }
        }
    );

    pub fn setup() {
        unsafe {
            let center = UNUserNotificationCenter::currentNotificationCenter();
            let delegate: Retained<MuseNotificationDelegate> =
                objc2::msg_send![MuseNotificationDelegate::class(), new];
            center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
            std::mem::forget(delegate); // must stay alive for the app's lifetime
        }
    }

    /// Replace all pending muse task reminders with the new list.
    /// Uses OS scheduling so delivery works regardless of foreground/background state.
    /// Returns the number of reminders successfully passed to UNUserNotificationCenter.
    pub fn schedule_reminders(reminders: &[super::TaskReminder]) -> u32 {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();

        let center = UNUserNotificationCenter::currentNotificationCenter();
        let mut queued: u32 = 0;

        for r in reminders {
            let interval = r.notify_at - now;
            if interval < 1.0 {
                continue; // already past or too soon to schedule
            }

            let content = UNMutableNotificationContent::new();
            content.setTitle(&NSString::from_str(&r.title));
            content.setBody(&NSString::from_str(&r.body));
            content.setSound(Some(&UNNotificationSound::defaultSound()));

            let trigger = UNTimeIntervalNotificationTrigger::
                triggerWithTimeInterval_repeats(interval, false);

            let notif_id = NSString::from_str(&format!("muse-task-{}", r.id));
            let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
                &notif_id,
                &content,
                Some(&trigger),
            );

            center.addNotificationRequest_withCompletionHandler(&request, None);
            queued += 1;
        }

        queued
    }

    // SAFETY: must only be called from the main thread (via AppHandle::run_on_main_thread)
    pub fn set_badge(count: u32) {
        unsafe {
            let mtm = MainThreadMarker::new_unchecked();
            let app = NSApplication::sharedApplication(mtm);
            let tile = app.dockTile();
            let label = if count == 0 {
                NSString::from_str("")
            } else {
                NSString::from_str(&count.to_string())
            };
            tile.setBadgeLabel(Some(&label));
        }
    }
}

/// Allow the frontend to register an additional directory in the asset protocol scope.
/// Needed when the user configures a custom data path — the default path is pre-registered
/// at startup, but custom paths must be registered dynamically.
#[tauri::command]
fn allow_asset_directory(app: tauri::AppHandle, path: String) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_directory(std::path::Path::new(&path), true)
        .map_err(|e| e.to_string())
}

/// Schedule OS-level UNNotificationRequests for todo reminders.
/// Returns the number of reminders actually queued with the system.
#[tauri::command]
fn schedule_todo_reminders(reminders: Vec<TaskReminder>) -> u32 {
    #[cfg(target_os = "macos")]
    { macos_notif::schedule_reminders(&reminders) }
    #[cfg(not(target_os = "macos"))]
    { let _ = reminders; 0 }
}

/// Update the macOS dock icon badge with the given count (0 clears it).
#[tauri::command]
fn set_dock_badge(app: tauri::AppHandle, count: u32) {
    #[cfg(target_os = "macos")]
    let _ = app.run_on_main_thread(move || macos_notif::set_badge(count));
    #[cfg(not(target_os = "macos"))]
    let _ = (app, count);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            allow_asset_directory,
            schedule_todo_reminders,
            set_dock_badge,
        ]);

    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_clipboard_manager::init());
    }

    let app = builder
        .setup(|app| {
            #[cfg(desktop)]
            {
                if let Ok(dir) = app.path().app_local_data_dir() {
                    let travel_notes = dir.join("muse").join("travel_notes");
                    let _ = app.asset_protocol_scope().allow_directory(&travel_notes, true);
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    // Set the macOS notification delegate AFTER all plugins finish initializing.
    // tauri-plugin-notification sets its own delegate during init; calling setup()
    // here ensures ours wins and willPresentNotification fires for foreground banners.
    #[cfg(target_os = "macos")]
    macos_notif::setup();

    app.run(|_app_handle, _event| {});
}

function show(enabled, useSettingsInsteadOfPreferences) {
    const copy = useSettingsInsteadOfPreferences
        ? {
              on: "扩展已启用。打开任意网页，选中文字或右键即可翻译。",
              off: "扩展当前已关闭。请在 Safari 设置 → 扩展中启用它。",
              unknown: "在 Safari 设置中启用「Safari Translator」扩展即可开始使用。",
              button: "打开 Safari 设置…"
          }
        : {
              on: "扩展已启用。打开任意网页，选中文字或右键即可翻译。",
              off: "扩展当前已关闭。请在 Safari 扩展偏好设置中启用它。",
              unknown: "在 Safari 扩展偏好设置中启用「Safari Translator」即可开始使用。",
              button: "打开 Safari 扩展偏好设置…"
          };

    document.querySelector(".state-on").textContent = copy.on;
    document.querySelector(".state-off").textContent = copy.off;
    document.querySelector(".state-unknown").textContent = copy.unknown;
    document.querySelector(".open-preferences").textContent = copy.button;

    if (typeof enabled === "boolean") {
        document.body.classList.toggle("state-on", enabled);
        document.body.classList.toggle("state-off", !enabled);
    } else {
        document.body.classList.remove("state-on");
        document.body.classList.remove("state-off");
    }
}

function openPreferences() {
    webkit.messageHandlers.controller.postMessage("open-preferences");
}

document.querySelector("button.open-preferences").addEventListener("click", openPreferences);

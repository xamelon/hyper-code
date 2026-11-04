// Emacs-style keys over the default keymap (setting keys.keymap = "emacs"). Prefixes C-x and C-h, M-x for
// the command menu, C-g to quit; C-n / C-p in lists. Browser keys a page cannot take are left out:
// C-n (new window), C-w (close tab), C-t (new tab). Bindings that would steal a native text-field key
// (C-k kill line, C-v paste on Linux, C-h delete on a Mac) say inInput: false — they work outside fields.
export default {
    extends: "default",
    bind: {
        // M-x: the command / navigation menu.
        "Alt-x": "nav.open",
        // C-x: buffers and windows.
        "Ctrl-x b": "nav.open",
        "Ctrl-x Ctrl-b": "dock.cycleMode",
        "Ctrl-x ArrowRight": "chat.nextUnread",
        "Ctrl-x ArrowLeft": "chat.jumpBack",
        "Ctrl-x o": "chat.focus",
        "Ctrl-x 1": "canvas.toggleChat",
        // C-h: help.
        "Ctrl-h b": { command: "keys.help", inInput: false },
        "Ctrl-h ?": { command: "keys.help", inInput: false },
        // C-g: keyboard-quit — leaves the message box.
        "Ctrl-g": { command: "chat.blur", inInput: true },
        // Scrolling the conversation.
        "Ctrl-v": { command: "chat.scrollDown", inInput: false },
        "Alt-v": "chat.scrollUp",
        // Default keys that are editing keys in Emacs: keep them for the text field.
        "Ctrl-k": { command: "chat.jumpBack", inInput: false },
        "Ctrl-j": { command: "chat.nextUnread", inInput: false },
        // Ctrl-b off a Mac is backward-char; the Dock is C-x C-b here.
        "Mod-b": null,
    },
    scopes: {
        menu: {
            "Ctrl-p": "menu.prev",
            "Ctrl-v": "menu.nextWidget",
            "Alt-v": "menu.prevWidget",
            "Ctrl-g": "menu.close",
            "Ctrl-m": "menu.open",
        },
        help: {
            "Ctrl-g": "keys.helpClose",
            "q": "keys.helpClose",
        },
    },
};

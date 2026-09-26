globalThis.EpdViewTabs = {
  create({ tabs, panels, isBusy, onSelect }) {
    const keys = ['file', 'custom'];
    let active = 'file';

    function sync() {
      for (const key of keys) {
        const selected = key === active;
        panels[key].hidden = !selected;
        tabs[key].setAttribute('aria-selected', String(selected));
        tabs[key].tabIndex = selected ? 0 : -1;
      }
    }

    function select(id, focus = false) {
      if (!keys.includes(id) || id === active || isBusy()) return false;
      active = id;
      sync();
      if (focus) tabs[id].focus();
      onSelect(id);
      return true;
    }

    for (const key of keys) {
      tabs[key].addEventListener('click', () => select(key));
      tabs[key].addEventListener('keydown', event => {
        const target = event.key === 'Home' ? 'file' :
          event.key === 'End' ? 'custom' :
            event.key === 'ArrowRight' || event.key === 'ArrowLeft' ? keys[1 - keys.indexOf(key)] : null;
        if (!target) return;
        event.preventDefault();
        select(target, true);
      });
    }

    sync();
    return { select, get active() { return active; } };
  },
};

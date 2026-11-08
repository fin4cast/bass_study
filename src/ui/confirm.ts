export interface ConfirmationOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
}

let active: HTMLDialogElement | null = null;

/** A reversible preview; no mutation is performed before the explicit button. */
export function confirmAction(options: ConfirmationOptions): Promise<boolean> {
  if (active) return Promise.resolve(false);
  const previous = document.activeElement instanceof HTMLElement || document.activeElement instanceof SVGElement ? document.activeElement : null;
  const dialog = document.createElement('dialog');
  dialog.className = 'confirm-dialog';
  dialog.setAttribute('aria-labelledby', 'confirmation-title');
  dialog.setAttribute('aria-describedby', 'confirmation-description');
  const heading = document.createElement('h2'); heading.id = 'confirmation-title'; heading.textContent = options.title;
  const message = document.createElement('p'); message.id = 'confirmation-description'; message.textContent = options.message;
  const actions = document.createElement('div'); actions.className = 'confirmation-actions';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'secondary-button'; cancel.textContent = 'Отмена'; cancel.autofocus = true;
  const confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'restore-button'; confirm.textContent = options.confirmLabel ?? 'Удалить';
  actions.append(cancel, confirm); dialog.append(heading, message, actions); document.body.append(dialog); active = dialog;
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return; settled = true;
      const accepted = dialog.returnValue === 'confirm';
      dialog.remove(); if (active === dialog) active = null;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      resolve(accepted);
    };
    cancel.addEventListener('click', () => dialog.close('cancel'));
    confirm.addEventListener('click', () => dialog.close('confirm'));
    dialog.addEventListener('cancel', event => { event.preventDefault(); dialog.close('cancel'); });
    dialog.addEventListener('close', finish, { once: true });
    dialog.showModal(); cancel.focus();
  });
}

export function dismissConfirmation() { active?.close('cancel'); }

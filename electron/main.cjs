/**
 * VERDANT / Electron 44.8: отдельное приложение с безопасным загрузчиком.
 * Доступ к Node.js внутри игрового рендера запрещён (sandbox + isolation).
 * F12 открывает инструменты разработчика в ОТДЕЛЬНОМ окне.
 */
const { app, BrowserWindow, dialog, net, protocol, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const ORIGIN = 'verdant://app';
const DEV_URL = 'http://127.0.0.1:5173/';
let win = null;

protocol.registerSchemesAsPrivileged([{
  scheme: 'verdant',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}]);

function installAppProtocol() {
  const siteRoot = path.resolve(app.getAppPath(), 'dist');
  protocol.handle('verdant', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Unknown host', { status: 403 });
    let relative;
    try { relative = decodeURIComponent(url.pathname); }
    catch { return new Response('Bad path', { status: 400 }); }
    // Защита от прохода к дисковым путям и служебным файлам приложения.
    if (relative.includes('\\') || relative.includes('\0') || /(^|\/)\.\.(\/|$)/.test(relative)) {
      return new Response('Forbidden', { status: 403 });
    }
    const resolved = path.resolve(siteRoot, '.' + relative);
    if (resolved !== siteRoot && !resolved.startsWith(siteRoot + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }
    const filename = resolved === siteRoot ? path.join(siteRoot, 'index.html') : resolved;
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filename).toString());
  });
}

function openDetachedDevTools() {
  if (!win || win.isDestroyed()) return;
  if (win.webContents.isDevToolsOpened()) win.webContents.closeDevTools();
  else win.webContents.openDevTools({ mode: 'detach', activate: true });
}

function createWindow() {
  win = new BrowserWindow({
    title: 'VERDANT',
    width: 1500,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#182f43',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: true
    }
  });
  win.once('ready-to-show', () => win?.show());
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      event.preventDefault();
      openDetachedDevTools();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/github\.com\//.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const expected = app.isPackaged ? ORIGIN : DEV_URL.replace(/\/$/, '');
    if (!url.startsWith(expected)) event.preventDefault();
  });
  const target = app.isPackaged ? `${ORIGIN}/index.html` : (process.env.VERDANT_DEV_URL || DEV_URL);
  win.loadURL(target).catch((error) => dialog.showErrorBox('VERDANT: ошибка загрузки', error.message));
  return win;
}

async function initProductionUpdater() {
  if (!app.isPackaged || process.platform !== 'win32') return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.on('error', (error) => console.warn('[VERDANT UPDATE]', error?.message || error));
    autoUpdater.on('update-available', (info) => console.log('[VERDANT UPDATE] Найден релиз:', info.version));
    autoUpdater.on('download-progress', (info) => console.log('[VERDANT UPDATE] Загрузка', Math.floor(info.percent), '%'));
    autoUpdater.on('update-downloaded', async (info) => {
      if (!win || win.isDestroyed()) return;
      const choice = await dialog.showMessageBox(win, {
        type: 'info', title: 'Обновление VERDANT',
        message: `Версия ${info.version} загружена`,
        detail: 'Сохраните игру и перезапустите приложение, чтобы применить обновление.',
        buttons: ['Позже', 'Перезапустить'], defaultId: 0, cancelId: 0
      });
      if (choice.response === 1) {
        // Автосохранение вызывается обработчиком beforeunload игрового окна.
        autoUpdater.quitAndInstall(false, true);
      }
    });
    const check = () => autoUpdater.checkForUpdates().catch((e) => console.warn('[VERDANT UPDATE]', e.message));
    setTimeout(check, 9000);
    setInterval(check, 30 * 60 * 1000);
  } catch (error) { console.warn('[VERDANT UPDATE] Механизм обновления не запущен:', error.message); }
}

app.whenReady().then(() => {
  if (app.isPackaged) installAppProtocol();
  createWindow();
  void initProductionUpdater();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

import { app, autoUpdater, dialog, shell } from 'electron';
import { updateElectronApp } from 'update-electron-app';

// =========================================================================
// 🛑 SEGURIDAD DE ACTUALIZACIONES
// Cambia esto a `true` cuando hayas configurado tus llaves criptográficas 
// (Apple Developer ID y/o Windows Authenticode) en GitHub Secrets.
// Al ponerlo en true, se activará el actualizador nativo invisible.
// =========================================================================
const HAS_CRYPTOGRAPHIC_KEYS = false;

export function initializeUpdater() {
  if (HAS_CRYPTOGRAPHIC_KEYS) {
    // Modo Nativo: Descarga e instala en segundo plano silenciosamente
    updateElectronApp();
  } else {
    // Modo Manual: Comprueba al iniciar sin molestar
    checkForUpdates(false);
  }
}

export async function checkForUpdates(showUpToDateDialog = true) {
  if (HAS_CRYPTOGRAPHIC_KEYS) {
    // Dispara el chequeo del autoUpdater nativo de Electron
    autoUpdater.checkForUpdates();
    return;
  }

  // --- Lógica de Fallback (Modo sin llaves) ---
  try {
    const currentVersion = app.getVersion();
    const response = await fetch('https://api.github.com/repos/ferxalbs/mate-x/releases/latest', {
      headers: { 'User-Agent': 'MaTE-X-Updater' }
    });

    if (!response.ok) {
      throw new Error('Error al conectar con GitHub');
    }

    const data = await response.json();
    const latestVersion = data.tag_name?.replace('v', '');

    if (latestVersion && latestVersion !== currentVersion) {
      const { response: userChoice } = await dialog.showMessageBox({
        type: 'info',
        title: 'Actualización Disponible',
        message: `¡Hay una nueva versión de MaTE X disponible!\n\nVersión actual: ${currentVersion}\nNueva versión: ${latestVersion}`,
        buttons: ['Descargar', 'Más tarde'],
        defaultId: 0,
        cancelId: 1
      });

      if (userChoice === 0) {
        shell.openExternal(data.html_url);
      }
    } else if (showUpToDateDialog) {
      // Solo mostramos este diálogo si el usuario hizo clic explícitamente en el botón "Check Updates"
      dialog.showMessageBox({
        type: 'info',
        title: 'MaTE X',
        message: '¡Ya tienes la versión más reciente!',
        buttons: ['Aceptar']
      });
    }
  } catch (error) {
    console.error('Failed to check for updates:', error);
    if (showUpToDateDialog) {
      dialog.showErrorBox('Error de Actualización', 'No se pudo comprobar si hay actualizaciones. Revisa tu conexión a internet.');
    }
  }
}

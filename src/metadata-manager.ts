import {
  createCustomMetadataDefinition,
  deleteCustomMetadataDefinition,
  listCustomMetadataDefinitions,
  renameCustomMetadataDefinition,
} from "./app/api.js";
import { confirm } from "@tauri-apps/plugin-dialog";

const root = document.querySelector("#metadata-manager-app") as HTMLElement | null;
let keys: string[] = [];

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function render(message = "", isError = false) {
  if (!root) return;
  root.innerHTML = `
    <h1>Metadatos</h1>
    <p class="subtitle">Gestiona los metadatos personalizados de todas las canciones.</p>
    <p class="message ${isError ? "error" : ""}">${escapeHtml(message)}</p>
    <section class="card">
      <h2>Crear metadato</h2>
      <form id="create-metadata-form" class="custom-form manager-create-form">
        <input name="key" required placeholder="Nombre del metadato" aria-label="Nombre del metadato">
        <button type="submit">Crear</button>
      </form>
    </section>
    <section class="card">
      <h2>Metadatos personalizados</h2>
      ${keys.length ? `<ul class="metadata-list manager-list">
        ${keys.map((key) => `
          <li data-key="${escapeHtml(key)}">
            <input value="${escapeHtml(key)}" aria-label="Nombre de ${escapeHtml(key)}">
            <button type="button" data-action="rename">Modificar</button>
            <button type="button" class="danger" data-action="delete">Eliminar</button>
          </li>
        `).join("")}
      </ul>` : "<p>No hay metadatos personalizados.</p>"}
    </section>
  `;
}

async function load(message = "") {
  keys = await listCustomMetadataDefinitions();
  render(message);
}

root?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target as HTMLFormElement);
  const key = String(data.get("key") ?? "");
  const confirmed = await confirm(
    `¿Crear el metadato "${key}" para todas las canciones?`,
    { title: "Confirmar creación", kind: "warning" },
  );
  if (!confirmed) return;
  try {
    await createCustomMetadataDefinition(key);
    await load("Metadato creado para todas las canciones.");
  } catch (error) {
    render(error instanceof Error ? error.message : String(error), true);
  }
});

root?.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  const row = button?.closest<HTMLLIElement>("li[data-key]");
  const oldKey = row?.dataset.key;
  if (!button || !row || !oldKey) return;
  try {
    if (button.dataset.action === "rename") {
      const newKey = row.querySelector<HTMLInputElement>("input")?.value ?? "";
      const confirmed = await confirm(
        `¿Cambiar "${oldKey}" por "${newKey}" en todas las canciones?`,
        { title: "Confirmar modificación", kind: "warning" },
      );
      if (!confirmed) return;
      await renameCustomMetadataDefinition(oldKey, newKey);
      await load("Metadato modificado en todas las canciones.");
    } else {
      const confirmed = await confirm(
        `¿Eliminar "${oldKey}" y todos sus valores de todas las canciones? Esta acción no se puede deshacer.`,
        { title: "Confirmar eliminación", kind: "warning" },
      );
      if (!confirmed) return;
      await deleteCustomMetadataDefinition(oldKey);
      await load("Metadato eliminado de todas las canciones.");
    }
  } catch (error) {
    render(error instanceof Error ? error.message : String(error), true);
  }
});

void load().catch((error) => render(error instanceof Error ? error.message : String(error), true));

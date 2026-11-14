#!/bin/bash

# Script para actualizar la versión de Tauri Music App
# Uso: ./update_version.sh <nueva_versión>
# Ejemplo: ./update_version.sh 1.1.0

if [ -z "$1" ]; then
    echo "Error: Debes especificar la nueva versión"
    echo "Uso: $0 <versión>"
    echo "Ejemplo: $0 1.1.0"
    exit 1
fi

NEW_VERSION="$1"
PROJECT_DIR="/home/hotsechu/Projects/tauri-music-app"

# Validar formato de versión (semver simple)
if ! [[ "$NEW_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Error: La versión debe seguir el formato X.Y.Z (ej: 1.0.0)"
    exit 1
fi

echo "Actualizando versión a: $NEW_VERSION"

# Actualizar package.json
if [ -f "$PROJECT_DIR/package.json" ]; then
    sed -i "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW_VERSION\"/" "$PROJECT_DIR/package.json"
    echo "✓ Actualizado package.json"
else
    echo "✗ No se encontró package.json"
fi

# Actualizar Cargo.toml
if [ -f "$PROJECT_DIR/src-tauri/Cargo.toml" ]; then
    sed -i "s/^version = \"[0-9]*\.[0-9]*\.[0-9]*\"/version = \"$NEW_VERSION\"/" "$PROJECT_DIR/src-tauri/Cargo.toml"
    echo "✓ Actualizado src-tauri/Cargo.toml"
else
    echo "✗ No se encontró src-tauri/Cargo.toml"
fi

# Actualizar tauri.conf.json
if [ -f "$PROJECT_DIR/src-tauri/tauri.conf.json" ]; then
    sed -i "s/\"version\": \"[0-9]*\.[0-9]*\.[0-9]*\"/\"version\": \"$NEW_VERSION\"/" "$PROJECT_DIR/src-tauri/tauri.conf.json"
    echo "✓ Actualizado src-tauri/tauri.conf.json"
else
    echo "✗ No se encontró src-tauri/tauri.conf.json"
fi

echo ""
echo "Versión actualizada a $NEW_VERSION en todos los archivos de configuración."
echo ""
echo "Para generar el nuevo .deb, ejecuta:"
echo "  cd $PROJECT_DIR && npm run tauri build"

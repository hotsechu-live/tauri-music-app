#!/bin/bash

# Script para actualizar la aplicación Tauri Music App desde el .deb generado
# Uso: sudo /home/hotsechu/update_tauri_app.sh

DEB_DIR="/home/hotsechu/Projects/tauri-music-app/src-tauri/target/release/bundle/deb"

# Buscar el archivo .deb más reciente
LATEST_DEB=$(find "$DEB_DIR" -name "*.deb" -type f -printf '%T@ %p\n' | sort -n | tail -1 | cut -d' ' -f2-)

if [ -z "$LATEST_DEB" ]; then
    echo "Error: No se encontró ningún archivo .deb en $DEB_DIR"
    exit 1
fi

echo "Encontrado archivo .deb: $LATEST_DEB"

# Instalar el paquete .deb
if dpkg -i "$LATEST_DEB"; then
    echo "Paquete instalado correctamente"
else
    echo "Corrigiendo dependencias..."
    apt-get install -f -y
    
    # Verificar si la instalación se completó
    if dpkg -i "$LATEST_DEB"; then
        echo "Paquete instalado correctamente después de corregir dependencias"
    else
        echo "Error: No se pudo instalar el paquete .deb"
        exit 1
    fi
fi

# Nombre del paquete (extraer del archivo .deb)
PACKAGE_NAME=$(dpkg-deb -f "$LATEST_DEB" Package)
VERSION=$(dpkg-deb -f "$LATEST_DEB" Version)

echo ""
echo "Aplicación actualizada: $PACKAGE_NAME versión $VERSION"
echo "Ruta del .deb: $LATEST_DEB"

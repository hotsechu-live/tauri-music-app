# Creación de la app TAURI-MUSIC-APP.
## Rol
Actúa como un arquitecto y desarrollador senior de aplicaciones de escritorio con experiencia en Tauri, TypeScript, Rust, SQLite y reproducción de audio local.
## Requisitos
Hay que desarrollar una aplicación de escritorio local-first para gestionar y reproducir una colección de música almacenada en carpetas locales. La aplicación debe construirse usando la siguiente pila tecnológica:
    • Framework de escritorio: Tauri 2
    • Frontend: TypeScript, HTML y CSS
    • Backend: Rust
    • Base de datos local: SQLite
    • Sistema operativo objetivo inicial: Windows
    • Diseño preparado para ser multiplataforma en el futuro: Windows, Linux y macOS
La aplicación debe permitir gestionar una colección de canciones almacenadas en local en una o varias carpetas accesibles por la aplicación. Los archivos de música podrán estar en distintos formatos, como MP3, FLAC, OGG, WAV, M4A u otros formatos habituales.
La aplicación debe tener las siguientes funcionalidades principales.
1. Gestión de la colección de canciones
2. Gestión de listas de música
3. Reproducción de listas de música
4. Reproducción de toda la música 
5. Filtrado de las canciones a reproducir

### 1. Gestión de la colección de canciones
La aplicación debe permitir seleccionar qué carpetas locales que contengan archivos de música deben de ser añadidas a la aplicación.
Cada carpeta se corresponderá con lo que se conocerá como “Colección”. El sistema pedirá al usuario que dé el nombre de la colección al seleccionar la carpeta para su inclusión en el sistema.
Si una carpeta del disco ha sido incluida como colección en la aplicación, no podrá volverse a incluir, salvo que se borre la colección y se importe de nuevo. 
Se dispondrá de un gestor de colecciones donde se pondrá consultar los datos asociados a cada colección: nombre, fecha de inclusión, localización de la carpeta en el disco.
El sistema solo permitirá cambiar el nombre de las colecciones.
Podrán borrarse colecciones, lo cual implicará la desaparición del sistema de los datos asociados a ellas, pero en ningún caso se borrará información del disco, ni carpetas ni canciones. 
La aplicación debe poder escanear las carpetas, de forma recursiva, detectando los archivos de audio compatibles antes de proceder a su inclusión en la aplicación.
Por cada archivo encontrado, la aplicación debe leer sus metadatos musicales y técnicos cuando estén disponibles, por ejemplo:
    • título
    • artista
    • álbum
    • género
    • año
    • duración
    • formato
    • tamaño del archivo
    • ruta completa del archivo
Los metadatos originales de los archivos de música solo deben leerse. La aplicación no debe modificar los archivos de música ni escribir metadatos dentro de ellos.
La información obtenida debe almacenarse en una base de datos SQLite local.
La aplicación debe permitir crear metadatos personalizados asociados a cada canción. Estos metadatos no deben guardarse en el archivo de música, sino únicamente en la base de datos SQLite. 
Tanto los metadatos propios de la canción como los personalizados deben poder darse de alta, modificarse y borrarse, pero este mantenimiento solo afectará a los datos guardados en la aplicación, los archivos de música en el disco se quedarán sin modificar.
La aplicación debe permitir listar todas las canciones detectadas.
El listado de canciones debe permitir buscar y filtrar canciones tanto por sus propios metadatos como por los metadatos personalizados. Los metadatos propios de cada canción que deben de permitir el filtrado serán:
    • colección
    • título
    • artista
    • álbum
    • género
    • año
Los metadatos personalizados para filtrar las canciones serán:
    • comentario
    • etiquetas
    • calificación personal
    • número de reproducciones

 ### 2. Gestión de listas de música
La aplicación debe permitir crear listas de música a partir de canciones seleccionadas en el listado principal.
Debe permitir las siguientes operaciones sobre listas:
    • alta de una nueva lista
    • modificación de una lista existente
    • borrado de una lista
    • consulta de las canciones incluidas en una lista
    • añadido de canciones a una lista
    • eliminación de canciones de una lista
    • modificación del orden de las canciones dentro de una lista
Cada lista debe tener un nombre y podrá tener una descripción corta opcional.
Cada lista podrá tener metadatos personalizados asociados. Estos metadatos tampoco se guardarán en los archivos de música, sino en la base de datos SQLite.
Los metadatos personalizados para las listas serán:
    • nombre
    • descripción corta
    • descripción extendida
    • finalidad
    • etiquetas
    • comentario
    • fecha de creación
    • última fecha de reproducción
    • duración estimada
El orden de reproducción de las canciones de una lista debe ser fijo y debe quedar almacenado explícitamente en la base de datos.
Cuando se cree o edite una lista, se debe poder definir el orden de las canciones. Este orden debe respetarse siempre durante la reproducción.
### 3. Reproducción de listas de música
La aplicación debe permitir reproducir las canciones incluidas en una lista.
La reproducción debe respetar el orden definido en la lista.
La aplicación debe soportar dos modos de reproducción:
Modo manual canción a canción:
    • El usuario selecciona una lista.
    • El usuario inicia la reproducción de una canción.
    • Cuando la canción termina, la reproducción se detiene.
    • La aplicación no debe iniciar automáticamente la siguiente canción.
    • El usuario debe decidir manualmente si quiere reproducir la siguiente canción, repetir la actual, seleccionar otra canción o detener la reproducción.
Modo secuencial:
    • El usuario selecciona una lista.
    • El usuario inicia la reproducción.
    • Cuando una canción termina, la aplicación debe iniciar automáticamente la siguiente canción de la lista.
    • La reproducción debe continuar hasta llegar al final de la lista o hasta que el usuario la detenga.
    • Al finalizar la última canción, la reproducción debe detenerse.
La aplicación debe permitir al menos estas acciones de reproducción:
    • reproducir
    • pausar
    • reanudar
    • detener
    • avanzar a la siguiente canción
    • volver a la canción anterior
    • seleccionar una canción concreta de la lista
    • cambiar entre modo manual y modo secuencial
La aplicación debe mostrar claramente:
    • canción actual
    • lista actual
    • modo de reproducción activo
    • estado de reproducción: detenido, reproduciendo, pausado
    • progreso de la canción actual
    • duración total de la canción actual

### 4. Reproducción de toda la música
Aparte de la reproducción de las listas, la aplicación deberá de permitir la reproducción secuencial o aleatoria de todas las canciones que se muestran en el listado de canciones, una vez aplicados los filtros que haya seleccionado el usuario.

### 4. Filtrado de las canciones a reproducir
En la parte superior del listado de músicas habrá un campo de búsqueda.
Cuando se incluya un texto en dicho campo de búsqueda, se mostrarán en el listado las canciones en las cuales algunos de sus metadatos, tanto propios como personalizados, incluyan dicho texto. 
A la derecha del campo se búsqueda habrá un desplegable con los valores: por defecto "Todos los campos", y a continuación el nombre de todos los metadatos disponibles, para que la búsqueda se restrinja solamente a ese campo. 

## Arquitectura esperada
Propón e implementa una arquitectura limpia separando claramente frontend, backend y persistencia.
La estructura sugerida debe ser similar a:
    • Frontend TypeScript:
        ◦ componentes de interfaz
        ◦ pantallas
        ◦ estado de la aplicación
        ◦ comunicación con comandos Tauri
        ◦ validación básica de formularios
    • Backend Rust:
        ◦ escaneo de carpetas
        ◦ lectura de metadatos de audio
        ◦ gestión de base de datos SQLite
        ◦ gestión de playlists
        ◦ gestión de colecciones
        ◦ gestión de reproducción
        ◦ exposición de comandos Tauri al frontend
    • SQLite:
        ◦ almacenamiento de canciones
        ◦ almacenamiento de metadatos personalizados
        ◦ almacenamiento de listas
        ◦ almacenamiento de canciones por lista
        ◦ almacenamiento del orden de reproducción
        ◦ almacenamiento de configuración de la aplicación
La aplicación debe diseñarse pensando en su mantenibilidad, la separación de responsabilidades y la facilidad de ampliación.

## Modelo de datos inicial
Diseña un esquema SQLite inicial que incluya, al menos, las siguientes entidades:
    • canciones
    • cancion_custom_metadata
    • listas
    • lista_custom_metadata
    • lista_canciones
    • app_settings
La tabla canciones debe contener la información básica y técnica de cada archivo de música.
La tabla cancion_custom_metadata debe permitir asociar pares clave-valor a cada canción.
La tabla listas debe contener la información principal de cada lista.
La tabla lista_custom_metadata debe permitir asociar pares clave-valor a cada lista.
La tabla lista_canciones debe relacionar listas con canciones e incluir el campo de posición para guardar el orden fijo de reproducción.
La tabla app_settings debe guardar la configuración general, como el modo de reproducción por defecto y otras preferencias futuras.
El esquema debe incluir claves primarias, claves foráneas, restricciones UNIQUE razonables, índices necesarios y borrados en cascada cuando corresponda.
## Comandos Tauri esperados
Define los comandos Tauri necesarios para que el frontend pueda comunicarse con el backend Rust.
Incluye comandos para:
    • seleccionar o registrar carpetas de música
    • escanear carpetas de música
    • listar canciones
    • buscar canciones
    • obtener detalle de una canción
    • actualizar metadatos personalizados de una canción
    • crear lista
    • editar lista
    • borrar lista
    • listar listas
    • obtener detalle de una lista
    • añadir canción a una lista
    • quitar canción de una lista
    • reordenar canciones de una lista
    • actualizar metadatos personalizados de una lista
    • reproducir canción
    • reproducir lista
    • pausar reproducción
    • reanudar reproducción
    • detener reproducción
    • reproducir siguiente canción
    • reproducir canción anterior
    • cambiar modo de reproducción
    • obtener estado actual del reproductor

## Interfaz de usuario
Propón una interfaz inicial sencilla, funcional y clara.
Debe incluir al menos las siguientes pantallas o secciones:
    • pantalla de configuración para seleccionar las carpetas de música a importar
    • pantalla de gestion de la colección de canciones
    • filtros y buscador
    • tabla/listado de canciones
    • panel de detalle de canción
    • editor de metadatos personalizados de canción
    • pantalla o panel de listas de música
    • editor de lista
    • editor del orden de canciones dentro de una lista
    • panel de reproducción
    • selector de modo de reproducción: manual canción a canción o secuencial
La interfaz debe priorizar claridad y facilidad de uso frente a complejidad visual.

## Flujo de uso principal
El flujo inicial de la aplicación debe ser:
    • El usuario abre la aplicación.
    • Si no hay una colección ya creada, 
        ◦ se le pide seleccionar una carpeta de música.
        ◦ La aplicación pide el nombre que se dará a esta colección.
        ◦ La aplicación escanea los archivos de música de la carpeta seleccionada.
        ◦ La aplicación guarda en SQLite la información de los archivos encontrados.
    • El usuario ve el listado de canciones.
    • El usuario filtra colecciones, filtra canciones o busca canciones.
    • El usuario crea una lista de música dándole un nombre.
    • El usuario añade canciones a la lista.
    • El usuario puede cambiar el orden de las canciones en la lista.
    • El usuario selecciona el modo de reproducción:
        ◦ Manual, canción a canción
        ◦ Secuencial, todas las canciones en secuencia.
        ◦ Aleatorio, todas las canciones sin orden. 
    • El usuario reproduce la lista.
    • La aplicación respeta el modo de reproducción seleccionado.

## Requisitos técnicos
Usa buenas prácticas de desarrollo.
El código debe estar organizado en módulos que se correspondan con las funionalidades.
Evita acoplar la lógica de negocio al frontend.
Evita guardar estado crítico solo en memoria si debe persistir entre sesiones.
Usa SQLite de forma segura, con consultas parametrizadas.
Ten en cuenta que los archivos pueden haber sido movidos, borrados o modificados desde el último escaneo.
Diseña el sistema para poder reescanear las carpetas, añadir nuevas carpetas y actualizar la base de datos.
Controla errores habituales:
    • carpeta no accesible
    • archivo eliminado
    • archivo no reproducible
    • metadatos inexistentes o corruptos
    • base de datos no inicializada
    • lista vacía
    • canción duplicada en una lista, si se decide no permitir duplicados
    • fallo durante la reproducción

## Entregables iniciales solicitados
Antes de escribir código, genera:
    • arquitectura general de la aplicación
    • estructura recomendada de carpetas del proyecto
    • esquema SQLite inicial
    • descripción de los principales módulos Rust
    • descripción de los principales módulos TypeScript
    • lista de comandos Tauri
    • flujo de datos entre frontend, backend y base de datos
    • propuesta de interfaz inicial
    • plan de implementación por fases
Después, genera una primera versión funcional mínima que permita:
    • iniciar un proyecto Tauri
    • inicializar SQLite
    • seleccionar o configurar una carpeta de música
    • escanear archivos de audio de una carpeta
    • guardar canciones detectadas en SQLite
    • mostrar el listado de canciones en el frontend
    • crear una lista
    • añadir canciones a una lista
    • definir el orden de canciones en la lista
    • reproducir una canción
    • reproducir una lista en modo manual canción a canción
    • reproducir una lista en modo secuencial
Prioriza una implementación sencilla, clara y extensible.
No sobreingenierices la primera versión.
Cuando haya varias opciones técnicas posibles, explica brevemente la recomendada y por qué.
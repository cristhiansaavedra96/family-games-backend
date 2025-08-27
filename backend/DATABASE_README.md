# Configuración de Base de Datos - Family Games

## Opción 1: Usando el script SQL directamente

1. **Crear la base de datos en MySQL/MariaDB:**
   ```bash
   mysql -u root -p < database_setup.sql
   ```

2. **O ejecutar paso a paso en consola MySQL:**
   ```sql
   source database_setup.sql;
   ```

## Opción 2: Usando Prisma (recomendado)

1. **Configurar variables de entorno:**
   ```bash
   # En backend/.env
   DATABASE_URL="mysql://usuario:password@localhost:3306/family_games"
   ```

2. **Ejecutar migración de Prisma:**
   ```bash
   cd backend
   npx prisma migrate dev --name "initial_setup"
   npx prisma generate
   ```

3. **Llenar datos de ejemplo (opcional):**
   ```bash
   npx prisma db seed
   ```

## Estructura de la Base de Datos

### Tabla Player
- `username` (PK): Identificador único del usuario
- `name`: Nombre para mostrar
- `avatarUrl`: Base64 de la foto del usuario
- `avatarId`: Hash MD5 para caché de avatar
- `createdAt`: Fecha de creación
- `updatedAt`: Fecha de última actualización (importante para sync)

### Tabla PlayerGameStats
- `id` (PK): ID auto-incremental
- `playerUsername` (FK): Referencia al username del Player
- `gameKey`: Tipo de juego (ej: "bingo")
- `points`: Puntos totales del jugador en ese juego
- `totalGames`: Total de partidas jugadas
- `wins`: Total de partidas ganadas

## Configuración de Conexión

Para desarrollo local, usar una de estas URLs:
```
# MySQL local
DATABASE_URL="mysql://root:password@localhost:3306/family_games"

# MariaDB local
DATABASE_URL="mysql://root:password@localhost:3307/family_games"

# MySQL con socket (Linux/Mac)
DATABASE_URL="mysql://root:password@localhost/family_games?socket=/var/run/mysqld/mysqld.sock"
```

## Comandos Útiles

```bash
# Verificar conexión
npx prisma db pull

# Ver datos en Prisma Studio
npx prisma studio

# Reset completo de BD
npx prisma migrate reset

# Aplicar cambios del esquema
npx prisma db push
```

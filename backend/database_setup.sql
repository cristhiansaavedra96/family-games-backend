-- Script SQL para crear la base de datos Family Games
-- Incluye sistema de avatares con sincronización y caché

-- Crear la base de datos si no existe
CREATE DATABASE IF NOT EXISTS family_games CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE family_games;

-- Tabla de jugadores con sistema de avatares
CREATE TABLE IF NOT EXISTS Player (
    username VARCHAR(191) NOT NULL PRIMARY KEY,
    name VARCHAR(255) NULL,
    avatarUrl LONGTEXT NULL COMMENT 'Base64 de la imagen del avatar',
    avatarId VARCHAR(191) NULL COMMENT 'Hash/ID único para caché de avatar',
    createdAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    
    INDEX idx_avatarId (avatarId),
    INDEX idx_updatedAt (updatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de estadísticas de juegos por jugador
CREATE TABLE IF NOT EXISTS PlayerGameStats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    playerUsername VARCHAR(191) NOT NULL,
    gameKey VARCHAR(191) NOT NULL,
    points INT NOT NULL DEFAULT 0,
    totalGames INT NOT NULL DEFAULT 0,
    wins INT NOT NULL DEFAULT 0,
    
    FOREIGN KEY (playerUsername) REFERENCES Player(username) ON DELETE CASCADE ON UPDATE CASCADE,
    UNIQUE KEY unique_player_game (playerUsername, gameKey),
    INDEX idx_gameKey (gameKey),
    INDEX idx_points (points),
    INDEX idx_wins (wins)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla para la migración de Prisma (requerida por Prisma)
CREATE TABLE IF NOT EXISTS _prisma_migrations (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    checksum VARCHAR(64) NOT NULL,
    finished_at DATETIME(3) NULL,
    migration_name VARCHAR(255) NOT NULL,
    logs TEXT NULL,
    rolled_back_at DATETIME(3) NULL,
    started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    applied_steps_count INT UNSIGNED NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Datos de ejemplo (opcional)
INSERT INTO Player (username, name) VALUES 
('admin', 'Administrador'),
('player1', 'Jugador 1'),
('player2', 'Jugador 2')
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- Estadísticas de ejemplo para bingo (opcional)
INSERT INTO PlayerGameStats (playerUsername, gameKey, points, totalGames, wins) VALUES 
('admin', 'bingo', 150, 5, 2),
('player1', 'bingo', 120, 4, 1),
('player2', 'bingo', 200, 6, 3)
ON DUPLICATE KEY UPDATE 
    points = VALUES(points),
    totalGames = VALUES(totalGames),
    wins = VALUES(wins);

-- Verificar las tablas creadas
SHOW TABLES;

-- Verificar estructura de Player
DESCRIBE Player;

-- Verificar estructura de PlayerGameStats  
DESCRIBE PlayerGameStats;

-- Consulta para ver jugadores con avatares
SELECT username, name, 
       CASE WHEN avatarId IS NOT NULL THEN 'Sí' ELSE 'No' END as tiene_avatar,
       createdAt, updatedAt 
FROM Player;

-- Consulta para ver estadísticas por juego
SELECT p.username, p.name, pgs.gameKey, pgs.points, pgs.totalGames, pgs.wins
FROM Player p
LEFT JOIN PlayerGameStats pgs ON p.username = pgs.playerUsername
ORDER BY pgs.gameKey, pgs.points DESC;

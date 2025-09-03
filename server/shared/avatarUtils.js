const sharp = require("sharp");

/**
 * Comprime un avatar en formato base64 a un tamaño objetivo específico
 * @param {string} base64Avatar - Avatar en formato base64 (data:image/...)
 * @param {number} targetSizeKB - Tamaño objetivo en KB (por defecto 50KB)
 * @returns {Promise<string>} Avatar comprimido en formato base64
 */
async function compressAvatar(base64Avatar, targetSizeKB = 50) {
  try {
    console.log(
      `🔧 Comprimiendo avatar original: ${(base64Avatar.length / 1024).toFixed(
        1
      )}KB`
    );

    // Separar el prefijo data:image del base64 puro
    const matches = base64Avatar.match(/^data:image\/([^;]+);base64,(.+)$/);
    if (!matches) {
      throw new Error("Formato de imagen base64 inválido");
    }

    const [, originalFormat, base64Data] = matches;
    console.log(`   - Formato original: ${originalFormat}`);

    // Convertir base64 a buffer
    const inputBuffer = Buffer.from(base64Data, "base64");

    // Configuración inicial de compresión
    let quality = 85;
    let width = 200;
    let height = 200;
    let compressed;
    let attempts = 0;
    const maxAttempts = 5;

    do {
      attempts++;
      console.log(
        `   - Intento ${attempts}: calidad=${quality}%, dimensiones=${width}x${height}`
      );

      // Comprimir imagen
      compressed = await sharp(inputBuffer)
        .resize(width, height, {
          fit: "cover",
          position: "center",
        })
        .jpeg({
          quality,
          progressive: true,
          mozjpeg: true, // Mejor compresión
        })
        .toBuffer();

      const compressedSizeKB = compressed.length / 1024;
      console.log(`   - Resultado: ${compressedSizeKB.toFixed(1)}KB`);

      // Si ya está dentro del tamaño objetivo, salir
      if (compressedSizeKB <= targetSizeKB || attempts >= maxAttempts) {
        break;
      }

      // Ajustar parámetros para siguiente intento
      if (compressedSizeKB > targetSizeKB * 1.5) {
        // Muy grande, reducir agresivamente
        quality = Math.max(quality - 20, 30);
        width = Math.max(width - 20, 100);
        height = Math.max(height - 20, 100);
      } else {
        // Casi en tamaño, ajuste fino
        quality = Math.max(quality - 10, 40);
      }
    } while (attempts < maxAttempts);

    // Convertir de vuelta a base64
    const compressedBase64 = `data:image/jpeg;base64,${compressed.toString(
      "base64"
    )}`;

    const finalSizeKB = compressedBase64.length / 1024;
    const reductionPercent = (
      ((base64Avatar.length - compressedBase64.length) / base64Avatar.length) *
      100
    ).toFixed(1);

    console.log(`✅ Compresión completada:`);
    console.log(`   - Tamaño final: ${finalSizeKB.toFixed(1)}KB`);
    console.log(`   - Reducción: ${reductionPercent}%`);
    console.log(`   - Intentos: ${attempts}`);

    return compressedBase64;
  } catch (error) {
    console.error("❌ Error comprimiendo avatar:", error);
    // En caso de error, retornar el original si no es demasiado grande
    if (base64Avatar.length <= 200 * 1024) {
      // 200KB máximo para fallback
      console.log("⚠️ Usando avatar original sin comprimir como fallback");
      return base64Avatar;
    } else {
      throw new Error("Avatar demasiado grande y falló la compresión");
    }
  }
}

/**
 * Valida que un avatar tenga el formato correcto
 * @param {string} avatarUrl - Avatar en formato base64
 * @returns {boolean} True si es válido
 */
function validateAvatarFormat(avatarUrl) {
  if (!avatarUrl || typeof avatarUrl !== "string") {
    return false;
  }

  return avatarUrl.startsWith("data:image/");
}

/**
 * Valida que el tamaño del avatar esté dentro de los límites permitidos
 * @param {string} avatarUrl - Avatar en formato base64
 * @param {number} maxSizeMB - Tamaño máximo en MB (por defecto 5MB)
 * @returns {boolean} True si está dentro del límite
 */
function validateAvatarSize(avatarUrl, maxSizeMB = 5) {
  if (!avatarUrl) return true;

  return avatarUrl.length <= maxSizeMB * 1024 * 1024;
}

module.exports = {
  compressAvatar,
  validateAvatarFormat,
  validateAvatarSize,
};

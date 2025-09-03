# Truco Uruguayo - Reglas e Instrucciones

## **Objetivo del juego:**

- Llegar a 30 puntos antes que el oponente
- Se juega a 2 o 4 jugadores (en parejas cuando son 4)

## **Cartas del mazo:**

- **Total de cartas**: 40 (se quitan los 8 y 9 de todos los palos)
- **Palos**: Espada (♠), Basto (♣), Oro (♦), Copa (♥)
- **Cartas por palo**: 1, 2, 3, 4, 5, 6, 7, 10, 11, 12

## **Desarrollo del juego:**

1. **Reparto**: Cada jugador recibe 3 cartas
2. **Muestra**: Se da vuelta una carta que determina las piezas
3. **Rondas**: Se juegan hasta 3 rondas por mano
4. **Ganador de mano**: Quien gane 2 de 3 rondas

## **JERARQUÍA DE CARTAS (de mayor a menor):**

### **PIEZAS (cartas de la muestra - más fuertes que todo):**

1. **2 de la muestra** - 30 puntos para envido
2. **4 de la muestra** - 29 puntos para envido
3. **5 de la muestra** - 28 puntos para envido
4. **11 de la muestra** - 27 puntos para envido
5. **10 de la muestra** - 27 puntos para envido
6. **ALCAHUETE (12 de la muestra)** - SOLO si la carta de muestra es una de las 5 piezas anteriores, toma su mismo valor

### **MATAS (siempre fuertes, pero menos que las piezas):**

7. **1 de Espada** (la espada)
8. **1 de Basto** (el basto)
9. **7 de Espada** (siete de espada)
10. **7 de Oro** (siete de oro)

### **Cartas comunes (orden descendente):**

11. **3 de cualquier palo**
12. **2 de otros palos** (no muestra)
13. **1 de otros palos** (1 de Oro y 1 de Copa cuando no son muestra)
14. **12 de cualquier palo** (incluyendo muestra cuando no es alcahuete)
15. **11 de otros palos** (no muestra)
16. **10 de otros palos** (no muestra)
17. **7 de otros palos** (7 de Copa y 7 de Basto cuando no son muestra)
18. **6 de cualquier palo** (incluyendo muestra)
19. **5 de otros palos** (no muestra)
20. **4 de otros palos** (no muestra)

## **SISTEMA DE PUNTUACIÓN:**

### **Truco:**

- **Truco**: 2 puntos
- **Re-truco**: 3 puntos
- **Vale cuatro**: 4 puntos

### **Envido:**

#### **Envido normal:**

- Se cuenta con las cartas del mismo palo
- Figuras (10, 11, 12) valen su número para envido
- Se suma **20 + las dos cartas más altas del mismo palo**
- Si no hay dos del mismo palo, vale **la carta más alta**

#### **Envido con PIEZAS:**

- **Valor de la pieza + carta común más alta del mismo palo**
- Las piezas tienen valores fijos: 2=30, 4=29, 5=28, 11=27, 10=27
- Ejemplo: Pieza de 28 pts + 7 = 35 puntos de envido

#### **Tipos de envido:**

- **Envido**: Variable según las cartas
- **Real envido**: 3 puntos
- **Falta envido**: Los puntos que le faltan al oponente para ganar

### **Flor:**

- **Flor**: 4 puntos
- **Contraflor**: 6 puntos

#### **Condiciones para Flor:**

- **2 cartas de la muestra** (2 piezas) = Flor
- **1 pieza + 2 cartas del mismo palo** = Flor
- **3 cartas del mismo palo** = Flor

## **EJEMPLOS PRÁCTICOS:**

### **Ejemplo 1: Muestra es 4 de Oro**

**Jerarquía:**

1. 4♦ (pieza - 29 pts)
2. 12♦ (alcahuete - 29 pts)
3. 2♦ (pieza - 30 pts)
4. 5♦ (pieza - 28 pts)
5. 11♦ (pieza - 27 pts)
6. 10♦ (pieza - 27 pts)
7. 1♠ (mata)
8. 1♣ (mata)
9. 7♠ (mata)
10. 7♦ (como pieza, ya está arriba)
11. Resto de cartas comunes...

### **Ejemplo 2: Muestra es 6 de Copa**

**Jerarquía:**

- **NO hay piezas** (6 no es pieza)
- **12♥ es carta común** (no es alcahuete)
- **6♥ es carta común**

1. 1♠ (mata)
2. 1♣ (mata)
3. 7♠ (mata)
4. 7♦ (mata)
5. 3 de cualquier palo
6. 2 de otros palos
7. ...resto de cartas comunes

## **PARTICULARIDADES DEL TRUCO URUGUAYO:**

- Las **piezas** son más fuertes que las **matas**
- El **alcahuete** solo funciona cuando la muestra es una pieza
- **Flor** tiene condiciones especiales con piezas
- **Envido** se calcula diferente con piezas
- El **mazo** (quien reparte) rota cada mano

## **NOTAS PARA IMPLEMENTACIÓN:**

- Verificar si la carta de muestra es pieza (2, 4, 5, 11, 10)
- Calcular jerarquía dinámicamente según la muestra
- Implementar lógica especial para alcahuete
- Sistema de puntuación para envido con piezas
- Detección automática de flor con reglas especiales

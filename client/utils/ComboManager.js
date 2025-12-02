export function showComboText(comboName, intensity = 1) {
    const text = this.add.text(400, 200, comboName, {
        fontSize: 48 * intensity,
        fontStyle: "bold",
        color: "#ffdd44",
    }).setOrigin(0.5);

    // Slight curve effect
    text.setAngle(-5);

    this.tweens.add({
        targets: text,
        y: 150,
        alpha: 0,
        angle: 5,
        duration: 800,
        ease: 'Cubic.easeOut',
        onComplete: () => text.destroy()
    });
}
	
export function checkCombo(values) {
    // Count occurrences
    const count = {};
    for (let v of values) {
        count[v] = (count[v] || 0) + 1;
    }
	
	const sorted = [...values].sort((a, b) => a - b);
    const unique = [...new Set(sorted)];

    const large1 = [1,2,3,4,5];
    const large2 = [2,3,4,5,6];

    const occurrences = Object.values(count);
	
	// 5-of-a-kind
    if (occurrences.includes(5)) {
        return { type: "FIVE OF A KIND?!!?!", multiplier: 10, intensity: 1.8 };
    }

    // 4-of-a-kind
    if (occurrences.includes(4)) {
        return { type: "FOUR OF A KIND!!!!", multiplier: 5, intensity: 1.5 };
    }
	
	// Full House: 3 + 2
    if (occurrences.includes(3) && occurrences.includes(2)) {
        return { type: "FULL HOUSE!!!", multiplier: 4, intensity: 1.4 };
    }

    // 3-of-a-kind
    if (occurrences.includes(3)) {
        return { type: "TRIPLE!", multiplier: 3, intensity: 1.2 };
    }

    // Pair
    if (occurrences.includes(2)) {
        return { type: "PAIR!", multiplier: 2, intensity: 1 };
    }
	
	// Large straight
	if (JSON.stringify(unique) === JSON.stringify(large1) ||
        JSON.stringify(unique) === JSON.stringify(large2)) {
        return { type: "LARGE STRAIGHT!!", multiplier: 3, intensity: 1.4 };
    }

    // Small straight
    for (let i = 0; i <= unique.length - 4; i++) {
        if (unique[i]+1 === unique[i+1] &&
            unique[i]+2 === unique[i+2] &&
            unique[i]+3 === unique[i+3]) {
            return { type: "STRAIGHT!", multiplier: 2.5, intensity: 1.2 };
        }
    }

    return null;
}
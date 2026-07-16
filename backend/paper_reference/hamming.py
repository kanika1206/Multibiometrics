def hamming_distance(phash_dict1, phash_dict2):
    total_distance = 0
    num_pairs = 0
    
    for key1 in phash_dict1:
        if key1 in phash_dict2:
            binary_str1 = bin(phash_dict1[key1])[2:].zfill(64)
            binary_str2 = bin(phash_dict2[key1])[2:].zfill(64)
            
            distance = sum(1 for bit1, bit2 in zip(binary_str1, binary_str2) if bit1 != bit2)
            total_distance += distance
            num_pairs += 1
    
    return total_distance / num_pairs
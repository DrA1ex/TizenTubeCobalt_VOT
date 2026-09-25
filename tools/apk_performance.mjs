export const GX1_MAX_VIDEO_BUFFER_MB = 64;

export function capVideoBufferBudget(xml, budgetMb = GX1_MAX_VIDEO_BUFFER_MB) {
    if (!Number.isInteger(budgetMb) || budgetMb < 32 || budgetMb > 200) {
        throw new Error('Video buffer budget must be an integer between 32 and 200 MB');
    }

    const pattern = /(<integer name="max_video_buffer_budget">)0(<\/integer>)/g;
    const matches = xml.match(pattern) || [];
    if (matches.length !== 1) {
        throw new Error('Unexpected max_video_buffer_budget resource layout');
    }

    return xml.replace(pattern, `$1${budgetMb}$2`);
}

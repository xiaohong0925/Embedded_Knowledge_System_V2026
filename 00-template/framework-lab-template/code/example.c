/*
 * Framework Lab Template placeholder.
 * This file only demonstrates same-source loading in the workbench.
 * It is not a driver and has not been compiled, run, or tested on hardware.
 */
struct example_request {
    int input;
    int output;
    int state;
};

static int example_execute(struct example_request *request)
{
    if (!request)
        return -1;

    request->state = 1;
    request->output = request->input * 2;
    request->state = 2;
    return 0;
}

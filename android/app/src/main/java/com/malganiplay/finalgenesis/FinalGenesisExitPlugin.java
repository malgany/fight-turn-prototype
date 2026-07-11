package com.malganiplay.finalgenesis;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FinalGenesisExit")
public class FinalGenesisExitPlugin extends Plugin {
    @PluginMethod
    public void exitAndRemoveTask(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            call.resolve();
            getActivity().finishAndRemoveTask();
        });
    }
}

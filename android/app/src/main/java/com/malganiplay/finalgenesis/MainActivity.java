package com.malganiplay.finalgenesis;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FinalGenesisExitPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

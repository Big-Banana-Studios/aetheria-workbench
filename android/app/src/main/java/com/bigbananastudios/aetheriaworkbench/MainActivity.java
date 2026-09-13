package com.bigbananastudios.aetheriaworkbench;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LlamaServerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
